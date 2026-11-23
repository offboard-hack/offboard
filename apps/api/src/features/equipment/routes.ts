import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse } from "../../shared/http.js";
import type { EquipmentRepository } from "./repository.js";

const equipmentStatus = t.Union([
  t.Literal("with_person"),
  t.Literal("scheduled"),
  t.Literal("transit"),
  t.Literal("received"),
  t.Literal("inventory"),
  t.Literal("failed"),
]);

const equipmentRow = t.Object({
  id: t.String(),
  item: t.String(),
  tag: t.String(),
  returnMethod: t.Union([t.Literal("pickup"), t.Literal("in_person")]),
  scheduledDate: t.Nullable(t.String()),
  status: equipmentStatus,
});

const equipmentListRow = t.Composite([equipmentRow, t.Object({ person: t.String() })]);

export function equipmentRoutes(repos: EquipmentRepository, access: PortalAccessPlugin) {
  return new Elysia()
    .use(access)
    .get("/equipment", () => repos.listEquipment(), {
      permit: ["read", "Offboarding"],
      response: t.Array(equipmentListRow),
    })
    .put(
      "/equipment/:id",
      async ({ params, body, status }) => {
        const updated = await repos.updateEquipmentStatus(params.id, body.status);

        if (!updated) return status(404, { error: "Equipment not found" });

        return updated;
      },
      {
        permit: ["update", "Offboarding"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({ status: equipmentStatus }),
        response: { 200: equipmentRow, 404: errorResponse },
      },
    );
}
