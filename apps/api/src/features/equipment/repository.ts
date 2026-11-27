import type { Database } from "@offboard/db/client";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { employeeAccess, equipment, offboardingCases } from "@offboard/db/schema";
import { uniqueViolation } from "../../shared/http.js";
import { personKey, resolveImport, type ImportedEquipment } from "./import.js";

type EquipmentStatus = (typeof equipment.$inferSelect)["status"];

export type EquipmentFailure = "missing-case" | "missing" | "plan" | "duplicate-tag";

function fail(failure: EquipmentFailure) {
  return { failure };
}

export type ManualEquipment = Pick<typeof equipment.$inferInsert, "item" | "tag" | "returnMethod">;

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

  async function createEquipment(orgId: string, caseId: string, data: ManualEquipment) {
    const [found] = await db
      .select({ id: offboardingCases.id })
      .from(offboardingCases)
      .where(and(eq(offboardingCases.id, caseId), eq(offboardingCases.orgId, orgId)));

    if (!found) return fail("missing-case");

    const [created] = await db
      .insert(equipment)
      .values({ ...data, orgId, caseId, status: "with_person", fromEmployeePlan: false })
      .onConflictDoNothing({ target: [equipment.orgId, equipment.tag] })
      .returning(columns);

    return created ? { row: created } : fail("duplicate-tag");
  }

  async function explainMiss(orgId: string, id: string) {
    const [row] = await db
      .select({ id: equipment.id })
      .from(equipment)
      .where(and(eq(equipment.id, id), eq(equipment.orgId, orgId)));

    return fail(row ? "plan" : "missing");
  }

  function manualRow(orgId: string, id: string) {
    return and(
      eq(equipment.id, id),
      eq(equipment.orgId, orgId),
      eq(equipment.fromEmployeePlan, false),
    );
  }

  async function updateEquipment(orgId: string, id: string, data: ManualEquipment) {
    try {
      const [updated] = await db
        .update(equipment)
        .set({ ...data, updatedAt: new Date() })
        .where(manualRow(orgId, id))
        .returning(columns);

      return updated ? { row: updated } : await explainMiss(orgId, id);
    } catch (error) {
      if (uniqueViolation.safeParse(error).success) return fail("duplicate-tag");

      throw error;
    }
  }

  async function deleteEquipment(orgId: string, id: string) {
    const [deleted] = await db
      .delete(equipment)
      .where(manualRow(orgId, id))
      .returning({ id: equipment.id });

    return deleted ? { row: deleted } : await explainMiss(orgId, id);
  }

  async function importEquipment(orgId: string, rows: ImportedEquipment[]) {
    const keys = [...new Set(rows.map(({ person }) => personKey(person)))];
    const tags = [...new Set(rows.map(({ tag }) => tag))];

    return db.transaction(async (tx) => {
      const cases = await tx
        .select({
          id: offboardingCases.id,
          name: offboardingCases.name,
          email: employeeAccess.email,
        })
        .from(offboardingCases)
        .leftJoin(
          employeeAccess,
          and(
            eq(employeeAccess.caseId, offboardingCases.id),
            eq(employeeAccess.orgId, offboardingCases.orgId),
          ),
        )
        .where(
          and(
            eq(offboardingCases.orgId, orgId),
            or(
              inArray(sql`lower(trim(${offboardingCases.name}))`, keys),
              inArray(sql`lower(trim(${employeeAccess.email}))`, keys),
            ),
          ),
        );

      const used = await tx
        .select({ tag: equipment.tag })
        .from(equipment)
        .where(and(eq(equipment.orgId, orgId), inArray(equipment.tag, tags)));

      const { problems, values } = resolveImport(rows, cases, new Set(used.map(({ tag }) => tag)));

      if (problems.length) return { problems, created: 0 };

      await tx.insert(equipment).values(
        values.map((value) => ({
          ...value,
          orgId,
          status: "with_person" as const,
          fromEmployeePlan: false,
        })),
      );

      return { problems, created: values.length };
    });
  }

  return {
    importEquipment,
    listEquipment,
    updateEquipmentStatus,
    createEquipment,
    updateEquipment,
    deleteEquipment,
  };
}

export type EquipmentRepository = ReturnType<typeof createEquipmentRepository>;
