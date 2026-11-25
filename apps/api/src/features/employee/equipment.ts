import type { Database } from "@offboard/db/client";
import { authUser, employeeAccess, employeeStates, equipment } from "@offboard/db/schema";
import type { ConfigValue } from "@offboard/db/schema";
import type { EmployeePlan } from "@offboard/employee";
import { departureSchema, type Booking } from "@offboard/employee/departure";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type EquipmentStatus = (typeof equipment.$inferSelect)["status"];

type PlanEquipment = EmployeePlan["equipment"];

export class EquipmentAlreadyAssigned extends Error {}

export function isReceived(status: EquipmentStatus) {
  return status === "received" || status === "inventory";
}

export async function readEquipment(
  db: Pick<Database, "select">,
  orgId: string,
  caseId: string,
  plan: PlanEquipment,
) {
  const rows = await db
    .select({ code: equipment.tag, title: equipment.item, status: equipment.status })
    .from(equipment)
    .where(and(eq(equipment.orgId, orgId), eq(equipment.caseId, caseId)))
    .orderBy(asc(equipment.tag));

  const models = new Map(plan.map(({ code, model }) => [code, model]));

  return rows.map(({ code, title, status }) => ({
    code,
    title,
    model: models.get(code) ?? "",
    received: isReceived(status),
  }));
}

export function allReceived(items: ReadonlyArray<{ received: boolean }>) {
  return items.length > 0 && items.every((item) => item.received);
}

export async function syncPlanEquipment(
  tx: Transaction,
  orgId: string,
  caseId: string,
  plan: PlanEquipment,
) {
  const items = new Map(plan.map((item) => [item.code, item.title]));
  const tags = [...items.keys()];
  const scope = and(eq(equipment.orgId, orgId), eq(equipment.caseId, caseId));

  await tx
    .delete(equipment)
    .where(
      and(
        scope,
        eq(equipment.fromEmployeePlan, true),
        tags.length ? notInArray(equipment.tag, tags) : undefined,
      ),
    );

  if (!items.size) return;

  const inserted = await tx
    .insert(equipment)
    .values(
      [...items]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tag, item]) => ({
          orgId,
          caseId,
          tag,
          item,
          status: "with_person" as const,
          returnMethod: "pickup" as const,
          fromEmployeePlan: true,
        })),
    )
    .onConflictDoUpdate({
      target: [equipment.orgId, equipment.tag],
      set: {
        item: sql`case when ${equipment.fromEmployeePlan} then excluded.item else ${equipment.item} end`,
      },
      setWhere: eq(equipment.caseId, caseId),
    })
    .returning({ id: equipment.id });

  if (inserted.length !== items.size)
    throw new EquipmentAlreadyAssigned("Equipment already assigned");
}

export async function syncEquipmentSchedule(
  tx: Transaction,
  orgId: string,
  caseId: string,
  old: Booking | null,
  next: Booking | null,
) {
  const scope = and(eq(equipment.orgId, orgId), eq(equipment.caseId, caseId));

  if (next) {
    await tx
      .update(equipment)
      .set({
        returnMethod: next.method === "pickup" ? "pickup" : "in_person",
        scheduledDate: next.day,
        status: "scheduled",
        updatedAt: new Date(),
      })
      .where(and(scope, inArray(equipment.status, ["with_person", "failed", "scheduled"])));
  } else if (old) {
    await tx
      .update(equipment)
      .set({
        scheduledDate: null,
        status: "with_person",
        updatedAt: new Date(),
      })
      .where(and(scope, eq(equipment.status, "scheduled"), eq(equipment.scheduledDate, old.day)));
  }
}

export async function setReceipt(
  tx: Transaction,
  orgId: string,
  caseId: string,
  code: string,
  received: boolean,
) {
  const scope = and(
    eq(equipment.orgId, orgId),
    eq(equipment.caseId, caseId),
    eq(equipment.tag, code),
  );

  const [item] = await tx
    .select({ status: equipment.status, day: equipment.scheduledDate })
    .from(equipment)
    .where(scope)
    .for("update");

  if (!item) return null;

  if (isReceived(item.status) === received) return false;

  await tx
    .update(equipment)
    .set({
      status: received ? "received" : item.day ? "scheduled" : "with_person",
      updatedAt: new Date(),
    })
    .where(scope);

  return true;
}

export function joinCurrentEmployee() {
  return eq(sql`lower(${employeeAccess.email})`, sql`lower(${authUser.email})`);
}

export function joinDepartureState() {
  return and(
    eq(employeeStates.orgId, employeeAccess.orgId),
    eq(employeeStates.caseId, employeeAccess.caseId),
    eq(employeeStates.userId, authUser.id),
    eq(employeeStates.key, "departure-v1"),
  );
}

export function currentBooking(value: ConfigValue) {
  return value === null ? null : departureSchema.parse(value).booking;
}
