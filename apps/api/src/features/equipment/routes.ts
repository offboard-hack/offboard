import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse } from "../../shared/http.js";
import type { EquipmentFailure, EquipmentRepository } from "./repository.js";

const equipmentStatus = t.Union([
  t.Literal("with_person"),
  t.Literal("scheduled"),
  t.Literal("transit"),
  t.Literal("received"),
  t.Literal("inventory"),
  t.Literal("failed"),
]);

const returnMethod = t.Union([t.Literal("pickup"), t.Literal("in_person")]);

const equipmentRow = t.Object({
  id: t.String(),
  item: t.String(),
  tag: t.String(),
  returnMethod,
  scheduledDate: t.Nullable(t.String()),
  status: equipmentStatus,
});

const manualEquipment = t.Object({
  item: t.String({ minLength: 1, maxLength: 255, pattern: "\\S" }),
  tag: t.String({ minLength: 1, maxLength: 255, pattern: "^\\S+$" }),
  returnMethod,
});

const importProblem = t.Union([
  t.Literal("unknown-person"),
  t.Literal("ambiguous-person"),
  t.Literal("tag-in-use"),
  t.Literal("repeated-tag"),
]);

const equipmentErrors = {
  "missing-case": [404, "Case not found"],
  missing: [404, "Equipment not found"],
  plan: [409, "Equipment comes from the employee plan"],
  "duplicate-tag": [409, "Asset tag already in use"],
} as const satisfies Record<EquipmentFailure, readonly [404 | 409, string]>;

const equipmentListRow = t.Composite([equipmentRow, t.Object({ person: t.String() })]);

export function equipmentRoutes(repos: EquipmentRepository, access: PortalAccessPlugin) {
  return new Elysia()
    .use(access)
    .get("/equipment", ({ principal }) => repos.listEquipment(principal.orgId), {
      permit: ["read", "Offboarding"],
      response: t.Array(equipmentListRow),
    })
    .put(
      "/equipment/:id",
      async ({ params, body, principal, status }) => {
        const updated = await repos.updateEquipmentStatus(principal.orgId, params.id, body.status);

        if (!updated) return status(404, { error: "Equipment not found" });

        return updated;
      },
      {
        permit: ["update", "Offboarding"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({ status: equipmentStatus }),
        response: { 200: equipmentRow, 404: errorResponse },
      },
    )
    .post(
      "/equipment",
      async ({ body: { caseId, ...data }, principal, status }) => {
        const created = await repos.createEquipment(principal.orgId, caseId, data);

        if ("failure" in created) {
          const [code, error] = equipmentErrors[created.failure];

          return status(code, { error });
        }

        return status(201, created.row);
      },
      {
        permit: ["update", "Offboarding"],
        body: t.Composite([manualEquipment, t.Object({ caseId: t.String({ format: "uuid" }) })]),
        response: { 201: equipmentRow, 404: errorResponse, 409: errorResponse },
      },
    )
    .post(
      "/equipment/import",
      async ({ body, principal, status }) => {
        const result = await repos.importEquipment(principal.orgId, body.rows);

        return result.problems.length
          ? status(422, { problems: result.problems })
          : status(201, { created: result.created });
      },
      {
        permit: ["update", "Offboarding"],
        body: t.Object({
          rows: t.Array(
            t.Composite([
              manualEquipment,
              t.Object({ person: t.String({ minLength: 1, maxLength: 255 }) }),
            ]),
            { minItems: 1, maxItems: 500 },
          ),
        }),
        response: {
          201: t.Object({ created: t.Number() }),
          422: t.Object({
            problems: t.Array(t.Object({ record: t.Number(), problem: importProblem })),
          }),
        },
      },
    )
    .patch(
      "/equipment/:id",
      async ({ params, body, principal, status }) => {
        const updated = await repos.updateEquipment(principal.orgId, params.id, body);

        if ("failure" in updated) {
          const [code, error] = equipmentErrors[updated.failure];

          return status(code, { error });
        }

        return updated.row;
      },
      {
        permit: ["update", "Offboarding"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: manualEquipment,
        response: { 200: equipmentRow, 404: errorResponse, 409: errorResponse },
      },
    )
    .delete(
      "/equipment/:id",
      async ({ params, principal, status }) => {
        const result = await repos.deleteEquipment(principal.orgId, params.id);

        if ("failure" in result) {
          const [code, error] = equipmentErrors[result.failure];

          return status(code, { error });
        }

        return new Response(null, { status: 204 });
      },
      {
        permit: ["update", "Offboarding"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 204: t.Void(), 404: errorResponse, 409: errorResponse },
      },
    );
}
