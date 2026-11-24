import type { Database } from "@offboard/db/client";
import { and, asc, eq, notInArray } from "drizzle-orm";
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

  async function updateEquipmentStatus(id: string, status: EquipmentStatus) {
    const [updated] = await db
      .update(equipment)
      .set({ status, updatedAt: new Date() })
      .where(eq(equipment.id, id))
      .returning(columns);

    return updated ?? null;
  }

  async function getEquipmentContext(id: string) {
    const [row] = await db
      .select({
        id: equipment.id,
        tag: equipment.tag,
        item: equipment.item,
        status: equipment.status,
        caseId: equipment.caseId,
        caseName: offboardingCases.name,
      })
      .from(equipment)
      .innerJoin(offboardingCases, eq(offboardingCases.id, equipment.caseId))
      .where(eq(equipment.id, id));

    return row ?? null;
  }

  async function areAllCaseEquipmentReceived(caseId: string) {
    const [pending] = await db
      .select({ id: equipment.id })
      .from(equipment)
      .where(
        and(eq(equipment.caseId, caseId), notInArray(equipment.status, ["received", "inventory"])),
      )
      .limit(1);

    return !pending;
  }

  return {
    listEquipment,
    updateEquipmentStatus,
    getEquipmentContext,
    areAllCaseEquipmentReceived,
  };
}

export type EquipmentRepository = ReturnType<typeof createEquipmentRepository>;
