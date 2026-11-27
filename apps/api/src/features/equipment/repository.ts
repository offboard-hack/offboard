import type { Database } from "@offboard/db/client";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { employeeAccess, equipment, offboardingCases } from "@offboard/db/schema";
import { normalizeHolderEmail } from "../../shared/equipment-holder.js";
import { uniqueViolation } from "../../shared/http.js";
import { personKey, resolveImport, type ImportedEquipment } from "./import.js";

type EquipmentStatus = (typeof equipment.$inferSelect)["status"];

export type EquipmentFailure =
  | "missing-case"
  | "missing"
  | "plan"
  | "duplicate-tag"
  | "unknown-email"
  | "ambiguous-email"
  | "assigned";

function fail(failure: EquipmentFailure) {
  return { failure };
}

export type ManualEquipment = Pick<typeof equipment.$inferInsert, "item" | "tag" | "returnMethod">;

export type NewEquipment = ManualEquipment & { caseId?: string; email?: string };

const columns = {
  id: equipment.id,
  item: equipment.item,
  tag: equipment.tag,
  returnMethod: equipment.returnMethod,
  scheduledDate: equipment.scheduledDate,
  status: equipment.status,
  holderEmail: equipment.holderEmail,
};

export function createEquipmentRepository(db: Database) {
  async function listEquipment(orgId: string) {
    const rows = await db
      .select({ ...columns, person: offboardingCases.name })
      .from(equipment)
      .leftJoin(
        offboardingCases,
        and(eq(offboardingCases.id, equipment.caseId), eq(offboardingCases.orgId, equipment.orgId)),
      )
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

  async function readRuleContext(orgId: string, id: string) {
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
      .leftJoin(offboardingCases, eq(offboardingCases.id, equipment.caseId))
      .where(and(eq(equipment.id, id), eq(equipment.orgId, orgId)));

    return row ?? null;
  }

  async function areAllCaseEquipmentReceived(orgId: string, caseId: string) {
    const rows = await db
      .select({ status: equipment.status })
      .from(equipment)
      .where(and(eq(equipment.orgId, orgId), eq(equipment.caseId, caseId)));

    return rows.length > 0 && rows.every((row) => row.status === "received");
  }

  async function casesWithEmail(orgId: string, email: string) {
    const key = normalizeHolderEmail(email);

    const rows = await db
      .select({ id: employeeAccess.caseId })
      .from(employeeAccess)
      .where(
        and(
          eq(employeeAccess.orgId, orgId),
          or(
            eq(sql`lower(${employeeAccess.email})`, key),
            eq(sql`lower(${employeeAccess.personalEmail})`, key),
          ),
        ),
      );

    return rows.map(({ id }) => id);
  }

  async function createEquipment(orgId: string, { caseId, email, ...data }: NewEquipment) {
    let target: string | null = null;
    let holderEmail: string | null = null;

    if (caseId) {
      const [found] = await db
        .select({ id: offboardingCases.id })
        .from(offboardingCases)
        .where(and(eq(offboardingCases.id, caseId), eq(offboardingCases.orgId, orgId)));

      if (!found) return fail("missing-case");

      target = found.id;
    } else if (email) {
      const matches = await casesWithEmail(orgId, email);

      if (matches.length > 1) return fail("ambiguous-email");

      target = matches[0] ?? null;
      holderEmail = target ? null : normalizeHolderEmail(email);
    }

    const [created] = await db
      .insert(equipment)
      .values({
        ...data,
        orgId,
        caseId: target,
        holderEmail,
        status: "with_person",
        fromEmployeePlan: false,
      })
      .onConflictDoNothing({ target: [equipment.orgId, equipment.tag] })
      .returning(columns);

    return created ? { row: created } : fail("duplicate-tag");
  }

  async function explainMiss(orgId: string, id: string, existing: "plan" | "assigned" = "plan") {
    const [row] = await db
      .select({ id: equipment.id })
      .from(equipment)
      .where(and(eq(equipment.id, id), eq(equipment.orgId, orgId)));

    return fail(row ? existing : "missing");
  }

  async function assignEquipment(orgId: string, id: string, email: string) {
    const matches = await casesWithEmail(orgId, email);

    if (matches.length > 1) return fail("ambiguous-email");

    if (!matches.length) return fail("unknown-email");

    const [updated] = await db
      .update(equipment)
      .set({ caseId: matches[0], holderEmail: null, updatedAt: new Date() })
      .where(and(eq(equipment.id, id), eq(equipment.orgId, orgId), isNull(equipment.caseId)))
      .returning(columns);

    return updated ? { row: updated } : await explainMiss(orgId, id, "assigned");
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
          personalEmail: employeeAccess.personalEmail,
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
              inArray(sql`lower(trim(${employeeAccess.personalEmail}))`, keys),
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
    readRuleContext,
    areAllCaseEquipmentReceived,
    createEquipment,
    assignEquipment,
    updateEquipment,
    deleteEquipment,
  };
}

export type EquipmentRepository = ReturnType<typeof createEquipmentRepository>;
