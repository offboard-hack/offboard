import type { Database } from "@offboard/db/client";
import { and, asc, eq } from "drizzle-orm";
import { equipment, offboardingCases } from "@offboard/db/schema";

type EquipmentStatus = (typeof equipment.$inferSelect)["status"];

const columns = {
  id: equipment.id,
  item: equipment.item,
  tag: equipment.tag,
  returnMethod: equipment.returnMethod,
  scheduledDate: equipment.scheduledDate,
  status: equipment.status,
};

export function createEquipmentRepository(db: Database) {
  async function listEquipment(orgId: string) {
    const rows = await db
      .select({ ...columns, person: offboardingCases.name })
      .from(equipment)
      .innerJoin(offboardingCases, eq(offboardingCases.id, equipment.caseId))
      .where(eq(equipment.orgId, orgId))
      .orderBy(asc(equipment.tag));

    return rows;
  }

  async function updateEquipmentStatus(orgId: string, id: string, status: EquipmentStatus) {
    const [updated] = await db
      .update(equipment)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(equipment.id, id), eq(equipment.orgId, orgId)))
      .returning(columns);

    return updated ?? null;
  }

  return {
    listEquipment,
    updateEquipmentStatus,
  };
}

export type EquipmentRepository = ReturnType<typeof createEquipmentRepository>;
