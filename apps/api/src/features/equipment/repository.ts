import type { Database } from "@offboard/db/client";
import { asc, eq } from "drizzle-orm";
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
  async function listEquipment() {
    const rows = await db
      .select({ ...columns, person: offboardingCases.name })
      .from(equipment)
      .innerJoin(offboardingCases, eq(offboardingCases.id, equipment.caseId))
      .orderBy(asc(equipment.tag));

    return rows;
  }

  async function getEquipmentByCase(caseId: string) {
    return db
      .select(columns)
      .from(equipment)
      .where(eq(equipment.caseId, caseId))
      .orderBy(asc(equipment.tag));
  }

  async function updateEquipmentStatus(id: string, status: EquipmentStatus) {
    const [updated] = await db
      .update(equipment)
      .set({ status, updatedAt: new Date() })
      .where(eq(equipment.id, id))
      .returning(columns);

    return updated ?? null;
  }

  return {
    listEquipment,
    getEquipmentByCase,
    updateEquipmentStatus,
  };
}

export type EquipmentRepository = ReturnType<typeof createEquipmentRepository>;
