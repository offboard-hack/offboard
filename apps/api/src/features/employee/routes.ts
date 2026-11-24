import {
  brazilTimezone,
  employeeAccessSchema,
  employeeGrantHeader,
  employeeStateSchema,
  stateKindSchema,
} from "@offboard/employee";
import { emptyCareer } from "@offboard/employee/career";
import { initialDeparture } from "@offboard/employee/departure";
import { Elysia, t } from "elysia";
import { z } from "zod";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { isEmployeeApp, type EmployeeAuth } from "../../shared/employee-auth.js";
import { errorResponse } from "../../shared/http.js";
import type { EmployeeRepository } from "./repository.js";

const caseParams = t.Object({ caseId: t.String({ format: "uuid" }) });

function initialState(key: z.infer<typeof stateKindSchema>, name: string) {
  switch (key) {
    case "consent":
      return { key, revision: 0, value: { accepted: false } } as const;
    case "departure-v1":
      return { key, revision: 0, value: initialDeparture } as const;
    case "career": {
      const today = new Intl.DateTimeFormat("sv-SE", { timeZone: brazilTimezone }).format();

      return { key, revision: 0, value: emptyCareer(name, today) } as const;
    }
  }
}

export function employeeRoutes(
  repo: EmployeeRepository,
  access: PortalAccessPlugin,
  resolveEmployee: EmployeeAuth | undefined,
  origin: string,
) {
  const employeeScope = new Elysia({ prefix: "/employee" }).resolve(
    async ({ request, set, status }) => {
      set.headers["cache-control"] = "private, no-store";
      const employee = await resolveEmployee?.(request.headers);

      if (!employee) return status(401, { error: "Unauthorized" });

      if (
        request.method !== "GET" &&
        request.headers.get("origin") !== origin &&
        !isEmployeeApp(request, origin)
      )
        return status(403, { error: "Forbidden" });

      return { employee };
    },
  );

  return new Elysia()
    .use(
      employeeScope
        .get("/session", ({ employee }) => employee)
        .guard({}, (scoped) =>
          scoped
            .onBeforeHandle(({ request, employee, status }) => {
              if (request.headers.get(employeeGrantHeader) !== employee.grantId) {
                return status(412, { error: "Employee session changed" });
              }
            })
            .get("/journey", async ({ employee, status }) => {
              const result = await repo.withAccess(employee, "read", async (data) => {
                const consent = await data.readState("consent");

                if (consent?.key !== "consent" || !consent.value.accepted) {
                  return status(403, { error: "Consent required" });
                }

                return data.readJourney();
              });

              return result ?? status(401, { error: "Unauthorized" });
            })
            .get(
              "/state/:key",
              async ({ employee, params, status }) => {
                const result = await repo.withAccess(employee, "read", async (data) => {
                  if (params.key !== "consent") {
                    const consent = await data.readState("consent");

                    if (consent?.key !== "consent" || !consent.value.accepted) {
                      return status(403, { error: "Consent required" });
                    }
                  }

                  return (
                    (await data.readState(params.key)) ?? initialState(params.key, employee.name)
                  );
                });

                return result ?? status(401, { error: "Unauthorized" });
              },
              { params: z.object({ key: stateKindSchema }) },
            )
            .put(
              "/state",
              async ({ body, employee, status }) => {
                const result = await repo.withAccess(employee, "write", async (data) => {
                  if (body.key !== "consent") {
                    const consent = await data.readState("consent");

                    if (consent?.key !== "consent" || !consent.value.accepted) {
                      return status(403, { error: "Consent required" });
                    }
                  }

                  if (body.key === "departure-v1") {
                    const journey = data.readJourney();

                    const previous = await data.readState("departure-v1");

                    const old =
                      previous?.key === "departure-v1" ? previous.value : initialDeparture;

                    const booking = body.value.booking;

                    if (
                      booking &&
                      JSON.stringify(booking) !== JSON.stringify(old.booking) &&
                      (!journey.plan.equipment.length ||
                        !journey.plan.bookingDays.includes(booking.day) ||
                        (booking.method === "office" && !journey.plan.officeAddress))
                    )
                      return status(422, { error: "Booking unavailable" });

                    if (body.value.examAttended && !old.examAttended && !journey.plan.exam) {
                      return status(422, { error: "Exam unavailable" });
                    }

                    const handoff = new Set(journey.plan.handoff.map(({ id }) => id));

                    if (
                      body.value.handoffCompleted.some(
                        (id) => !handoff.has(id) && !old.handoffCompleted.includes(id),
                      )
                    ) {
                      return status(422, { error: "Handoff item unavailable" });
                    }
                  }

                  return (await data.saveState(body)) ?? status(409, { error: "State changed" });
                });

                return result ?? status(401, { error: "Unauthorized" });
              },
              { body: employeeStateSchema },
            ),
        ),
    )
    .use(access)
    .onBeforeHandle(({ status }) => {
      if (!resolveEmployee)
        return status(503, { error: "Employee authentication is not configured" });
    })
    .get(
      "/employee-access/:caseId",
      async ({ params, status }) =>
        (await repo.readSettings(params.caseId)) ?? status(404, { error: "Case not found" }),
      {
        params: caseParams,
        permit: ["update", "Offboarding"],
        response: { 200: employeeAccessSchema, 404: errorResponse },
      },
    )
    .put(
      "/employee-access/:caseId",
      async ({ body, params, status }) => {
        const result = await repo.saveSettings(params.caseId, body);

        if (result === "missing-case") return status(404, { error: "Case not found" });

        if (result === "email-in-use")
          return status(409, { error: "Email already in use", code: "email-in-use" });

        if (result === "changed")
          return status(409, { error: "Employee settings changed", code: "settings-changed" });

        return { ...body, revision: body.revision + 1 };
      },
      { params: caseParams, body: employeeAccessSchema, permit: ["update", "Offboarding"] },
    );
}
