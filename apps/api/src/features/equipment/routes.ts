import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse, uniqueViolation } from "../../shared/http.js";
import type { EquipmentRepository } from "./repository.js";

const equipmentStatus = t.Union([
  t.Literal("in_use"),
  t.Literal("pending_return"),
  t.Literal("in_transit"),
  t.Literal("received"),
  t.Literal("in_inventory"),
  t.Literal("decommissioned"),
]);

const returnMethod = t.Union([t.Literal("pickup"), t.Literal("in_person"), t.Literal("correios")]);

const equipmentRow = t.Object({
  id: t.String(),
  item: t.String(),
  tag: t.String(),
  serialNumber: t.Nullable(t.String()),
  assignedTo: t.Nullable(t.String()),
  assignedEmail: t.Nullable(t.String()),
  status: equipmentStatus,
  returnMethod: t.Nullable(returnMethod),
  trackingCode: t.Nullable(t.String()),
  scheduledDate: t.Nullable(t.String()),
  caseId: t.Nullable(t.String()),
  taskId: t.Nullable(t.String()),
  notes: t.Nullable(t.String()),
});

const text = t.String({ minLength: 1, maxLength: 255 });

const optionalText = (maxLength: number) => t.Optional(t.Nullable(t.String({ maxLength })));

const dateString = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

const editableFields = {
  serialNumber: optionalText(100),
  assignedTo: optionalText(255),
  assignedEmail: optionalText(255),
  status: t.Optional(equipmentStatus),
  returnMethod: t.Optional(t.Nullable(returnMethod)),
  trackingCode: optionalText(100),
  scheduledDate: t.Optional(t.Nullable(dateString)),
  notes: t.Optional(t.Nullable(t.String())),
};

const idParams = t.Object({ id: t.String({ format: "uuid" }) });

const tag = t.String({ minLength: 1, maxLength: 50 });

export function equipmentRoutes(repos: EquipmentRepository, access: PortalAccessPlugin) {
  return new Elysia()
    .use(access)
    .get("/equipment", ({ query }) => repos.listEquipment(query), {
      permit: ["read", "Offboarding"],
      query: t.Object({
        status: t.Optional(equipmentStatus),
        assignedTo: t.Optional(t.String()),
        caseId: t.Optional(t.String({ format: "uuid" })),
      }),
      response: t.Array(equipmentRow),
    })
    .get("/equipment/by-case/:caseId", ({ params }) => repos.getEquipmentByCase(params.caseId), {
      permit: ["read", "Offboarding"],
      params: t.Object({ caseId: t.String({ format: "uuid" }) }),
      response: t.Array(equipmentRow),
    })
    .get(
      "/equipment/:id",
      async ({ params, status }) => {
        const found = await repos.getEquipment(params.id);

        return found ?? status(404, { error: "Equipment not found" });
      },
      {
        permit: ["read", "Offboarding"],
        params: idParams,
        response: { 200: equipmentRow, 404: errorResponse },
      },
    )
    .post(
      "/equipment",
      async ({ body, set, status }) => {
        try {
          const created = await repos.createEquipment(body);
          set.status = 201;

          return created;
        } catch (error) {
          if (uniqueViolation.safeParse(error).success) {
            return status(409, { error: "Equipment tag already exists" });
          }

          throw error;
        }
      },
      {
        permit: ["manage", "all"],
        body: t.Object({ item: text, tag, ...editableFields }),
        response: { 201: equipmentRow, 409: errorResponse },
      },
    )
    .put(
      "/equipment/:id",
      async ({ params, body, status }) => {
        try {
          const updated = await repos.updateEquipment(params.id, body);

          return updated ?? status(404, { error: "Equipment not found" });
        } catch (error) {
          if (uniqueViolation.safeParse(error).success) {
            return status(409, { error: "Equipment tag already exists" });
          }

          throw error;
        }
      },
      {
        permit: ["update", "Offboarding"],
        params: idParams,
        body: t.Object({
          item: t.Optional(text),
          tag: t.Optional(tag),
          caseId: t.Optional(t.Null()),
          taskId: t.Optional(t.Null()),
          ...editableFields,
        }),
        response: { 200: equipmentRow, 404: errorResponse, 409: errorResponse },
      },
    )
    .delete(
      "/equipment/:id",
      async ({ params, status }) => {
        const result = await repos.deleteEquipment(params.id);

        if (result === "not_found") return status(404, { error: "Equipment not found" });

        if (result === "blocked") {
          return status(409, {
            error: "Only decommissioned or in-inventory equipment can be deleted",
          });
        }

        return new Response(null, { status: 204 });
      },
      {
        permit: ["manage", "all"],
        params: idParams,
        response: { 204: t.Void(), 404: errorResponse, 409: errorResponse },
      },
    )
    .post(
      "/equipment/:id/assign-case",
      async ({ params, body, status }) => {
        const result = await repos.assignToCase(params.id, body.caseId, body.taskId);

        if (result.error) {
          const messages = {
            equipment_not_found: "Equipment not found",
            case_not_found: "Offboarding not found",
            task_not_found: "Task not found",
          };

          return status(404, { error: messages[result.error] });
        }

        return result.equipment;
      },
      {
        permit: ["update", "Offboarding"],
        params: idParams,
        body: t.Object({
          caseId: t.String({ format: "uuid" }),
          taskId: t.Optional(t.String({ format: "uuid" })),
        }),
        response: { 200: equipmentRow, 404: errorResponse },
      },
    );
}
