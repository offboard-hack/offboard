import type { Database } from "@offboard/db/client";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { equipment, offboardingCases, tasks } from "@offboard/db/schema";

type EquipmentRow = typeof equipment.$inferSelect;

type EquipmentStatus = EquipmentRow["status"];

export type EquipmentFilters = {
  status?: EquipmentStatus;
  assignedTo?: string;
  caseId?: string;
};

export type NewEquipment = Pick<typeof equipment.$inferInsert, "item" | "tag"> &
  Partial<
    Pick<
      typeof equipment.$inferInsert,
      | "serialNumber"
      | "assignedTo"
      | "assignedEmail"
      | "status"
      | "returnMethod"
      | "trackingCode"
      | "scheduledDate"
      | "notes"
    >
  >;

export type EquipmentChanges = Partial<
  Pick<
    typeof equipment.$inferInsert,
    | "item"
    | "tag"
    | "serialNumber"
    | "assignedTo"
    | "assignedEmail"
    | "status"
    | "returnMethod"
    | "trackingCode"
    | "scheduledDate"
    | "notes"
    | "caseId"
    | "taskId"
  >
>;

const removableStatuses: EquipmentStatus[] = ["decommissioned", "in_inventory"];

const columns = {
  id: equipment.id,
  item: equipment.item,
  tag: equipment.tag,
  serialNumber: equipment.serialNumber,
  assignedTo: equipment.assignedTo,
  assignedEmail: equipment.assignedEmail,
  status: equipment.status,
  returnMethod: equipment.returnMethod,
  trackingCode: equipment.trackingCode,
  scheduledDate: equipment.scheduledDate,
  caseId: equipment.caseId,
  taskId: equipment.taskId,
  notes: equipment.notes,
};

export function createEquipmentRepository(db: Database) {
  async function listEquipment(filters: EquipmentFilters = {}) {
    const conditions = [
      filters.status ? eq(equipment.status, filters.status) : undefined,
      filters.assignedTo ? eq(equipment.assignedTo, filters.assignedTo) : undefined,
      filters.caseId ? eq(equipment.caseId, filters.caseId) : undefined,
    ];

    return db
      .select(columns)
      .from(equipment)
      .where(and(...conditions))
      .orderBy(asc(equipment.tag));
  }

  async function getEquipment(id: string) {
    const [row] = await db.select(columns).from(equipment).where(eq(equipment.id, id));

    return row ?? null;
  }

  async function createEquipment(data: NewEquipment) {
    const [row] = await db.insert(equipment).values(data).returning(columns);

    return row;
  }

  async function updateEquipment(id: string, data: EquipmentChanges) {
    const [row] = await db
      .update(equipment)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(equipment.id, id))
      .returning(columns);

    return row ?? null;
  }

  async function deleteEquipment(id: string) {
    const removed = await db
      .delete(equipment)
      .where(and(eq(equipment.id, id), inArray(equipment.status, removableStatuses)))
      .returning({ id: equipment.id });

    if (removed.length > 0) return "deleted" as const;

    const existing = await getEquipment(id);

    return existing ? ("blocked" as const) : ("not_found" as const);
  }

  async function assignToCase(equipmentId: string, caseId: string, taskId?: string) {
    const existing = await getEquipment(equipmentId);

    if (!existing) return { equipment: null, error: "equipment_not_found" as const };

    const [foundCase] = await db
      .select({ id: offboardingCases.id })
      .from(offboardingCases)
      .where(eq(offboardingCases.id, caseId));

    if (!foundCase) return { equipment: null, error: "case_not_found" as const };

    if (taskId) {
      const [foundTask] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.caseId, caseId)));

      if (!foundTask) return { equipment: null, error: "task_not_found" as const };
    }

    const [row] = await db
      .update(equipment)
      .set({
        caseId,
        taskId: taskId ?? null,
        status: sql`case when ${equipment.status} = 'in_use' then 'pending_return'::equipment_status else ${equipment.status} end`,
        updatedAt: new Date(),
      })
      .where(eq(equipment.id, equipmentId))
      .returning(columns);

    return { equipment: row, error: null };
  }

  async function getEquipmentByCase(caseId: string) {
    return listEquipment({ caseId });
  }

  async function getEquipmentWithTracking() {
    return db
      .select({
        id: equipment.id,
        trackingCode: sql<string>`${equipment.trackingCode}`,
        taskId: sql<
          string | null
        >`case when ${tasks.status} = 'done' then null else ${equipment.taskId} end`,
      })
      .from(equipment)
      .leftJoin(tasks, eq(tasks.id, equipment.taskId))
      .where(and(isNotNull(equipment.trackingCode), eq(equipment.status, "in_transit")));
  }

  return {
    listEquipment,
    getEquipment,
    createEquipment,
    updateEquipment,
    deleteEquipment,
    assignToCase,
    getEquipmentByCase,
    getEquipmentWithTracking,
  };
}

export type EquipmentRepository = ReturnType<typeof createEquipmentRepository>;
