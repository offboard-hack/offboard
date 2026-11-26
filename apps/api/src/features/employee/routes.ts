import {
  brazilTimezone,
  employeeAccessSchema,
  employeeAccessSettingsSchema,
  employeeGrantHeader,
  employeeStateSchema,
  stateKindSchema,
} from "@offboard/employee";
import { emptyCareer } from "@offboard/employee/career";
import { initialDeparture } from "@offboard/employee/departure";
import { Elysia, t } from "elysia";
import { z } from "zod";
import { dispatchTaskAction, type DispatchAction } from "../../shared/action-dispatch.js";
import type { ChecklistChange } from "./checklist.js";
import { allReceived } from "./equipment.js";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { isEmployeeApp, type EmployeeAuth } from "../../shared/employee-auth.js";
import type { InviteEmployee } from "../../shared/employee-invite.js";
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
  dispatchAction: DispatchAction,
  inviteEmployee: InviteEmployee,
) {
  function dispatchChanges(changes: ChecklistChange[]) {
    for (const change of changes) {
      void dispatchTaskAction(dispatchAction, change).catch(() => {});
    }
  }

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
              const result = await repo.withAccess(employee, "read", async (data) =>
                data.readJourney(),
              );

              return result ?? status(401, { error: "Unauthorized" });
            })
            .patch(
              "/checklist/:taskId",
              async ({ employee, params, body, status }) => {
                const result = await repo.withAccess(employee, "write", async (data) => {
                  const consent = await data.readState("consent");

                  if (consent?.key !== "consent" || !consent.value.accepted)
                    return status(403, { error: "Consent required" });

                  return (
                    (await data.setChecklistTask(params.taskId, body.done)) ??
                    status(404, { error: "Employee task unavailable" })
                  );
                });

                if (!result) return status(401, { error: "Unauthorized" });

                if (!("changes" in result)) return result;

                const { changes, ...task } = result;
                dispatchChanges(changes);

                return task;
              },
              {
                params: t.Object({ taskId: t.String({ format: "uuid" }) }),
                body: t.Object({ done: t.Boolean() }),
              },
            )
            .get(
              "/state/:key",
              async ({ employee, params, status }) => {
                const result = await repo.withAccess(
                  employee,
                  "read",
                  async (data) =>
                    (await data.readState(params.key)) ?? initialState(params.key, employee.name),
                );

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
                    const journey = await data.readJourney();

                    const previous = await data.readState("departure-v1");

                    const old =
                      previous?.key === "departure-v1" ? previous.value : initialDeparture;

                    const booking = body.value.booking;

                    if (
                      JSON.stringify(booking) !== JSON.stringify(old.booking) &&
                      (allReceived(journey.equipment) ||
                        (booking &&
                          (!journey.equipment.length ||
                            !journey.plan.bookingDays.includes(booking.day) ||
                            (booking.method === "office" && !journey.plan.officeAddress))))
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

                    const saved = await data.saveState(body);

                    if (!saved) return status(409, { error: "State changed" });

                    return { saved, changes: await data.syncDeparture(old, body.value) };
                  }

                  const saved = await data.saveState(body);

                  return saved ? { saved, changes: [] } : status(409, { error: "State changed" });
                });

                if (!result) return status(401, { error: "Unauthorized" });

                if (!("saved" in result)) return result;

                dispatchChanges(result.changes);

                return result.saved;
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
    .get("/equipment-returns", ({ principal }) => repo.listEquipmentReturns(principal.orgId), {
      permit: ["read", "Offboarding"],
    })
    .get(
      "/equipment-returns/:caseId",
      ({ params, principal }) => repo.listEquipmentReturns(principal.orgId, params.caseId),
      {
        params: caseParams,
        permit: ["read", "Offboarding"],
      },
    )
    .get(
      "/equipment-returns/:caseId/address",
      async ({ params, principal, status }) =>
        (await repo.readCollectionBooking(principal.orgId, params.caseId)) ??
        status(404, { error: "Case not found" }),
      { params: caseParams, permit: ["update", "Offboarding"] },
    )
    .patch(
      "/equipment-returns/:caseId/receipt",
      async ({ params, body, principal, status }) => {
        const result = await repo.updateReceipt(
          principal.orgId,
          params.caseId,
          body.code,
          body.received,
        );

        if (!result) return status(404, { error: "Equipment not found" });

        dispatchChanges(result.changes);

        return { received: result.received };
      },
      {
        params: caseParams,
        body: t.Object({ code: t.String({ minLength: 1, maxLength: 255 }), received: t.Boolean() }),
        permit: ["update", "Offboarding"],
      },
    )
    .get(
      "/employee-access/:caseId",
      async ({ params, principal, status }) =>
        (await repo.readSettings(principal.orgId, params.caseId)) ??
        status(404, { error: "Case not found" }),
      {
        params: caseParams,
        permit: ["update", "Offboarding"],
        response: { 200: employeeAccessSettingsSchema, 404: errorResponse },
      },
    )
    .put(
      "/employee-access/:caseId",
      async ({ body, params, principal, status }) => {
        const result = await repo.saveSettings(principal.orgId, params.caseId, body);

        if (result === "missing-case") return status(404, { error: "Case not found" });

        if (result === "email-in-use")
          return status(409, { error: "Email already in use", code: "email-in-use" });

        if (result === "equipment-in-use")
          return status(409, { error: "Equipment already assigned", code: "equipment-in-use" });

        if (result === "changed")
          return status(409, { error: "Employee settings changed", code: "settings-changed" });

        if (result === "email-set") await inviteEmployee(principal.orgId, params.caseId);

        return (
          (await repo.readSettings(principal.orgId, params.caseId)) ??
          status(404, { error: "Case not found" })
        );
      },
      { params: caseParams, body: employeeAccessSchema, permit: ["update", "Offboarding"] },
    )
    .post(
      "/employee-access/:caseId/invite",
      async ({ params, principal, status }) => {
        const result = await inviteEmployee(principal.orgId, params.caseId);

        if (result === "missing-case") return status(404, { error: "Case not found" });

        if (result === "no-email") return status(409, { error: "Employee email missing" });

        if (result === "failed") return status(502, { error: "Invite not sent" });

        return { sent: true };
      },
      {
        params: caseParams,
        permit: ["update", "Offboarding"],
        response: {
          200: t.Object({ sent: t.Literal(true) }),
          404: errorResponse,
          409: errorResponse,
          502: errorResponse,
        },
      },
    );
}
