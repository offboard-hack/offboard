import { asc, eq } from "drizzle-orm";
import { equipment } from "../schema/index.ts";
import type { EquipmentDto, EquipmentRepository } from "./interfaces.ts";
import type { Db } from "./tasks.ts";

type DbEquipmentStatus =
  | "failed"
  | "inventory"
  | "received"
  | "scheduled"
  | "transit"
  | "with_person";

const toDb = {
  scheduled: "scheduled",
  received: "received",
  failed: "failed",
  inventory: "inventory",
  transit: "transit",
  withPerson: "with_person",
} as const satisfies Record<EquipmentDto["status"], DbEquipmentStatus>;

const toDto = {
  scheduled: "scheduled",
  received: "received",
  failed: "failed",
  inventory: "inventory",
  transit: "transit",
  with_person: "withPerson",
} as const satisfies Record<DbEquipmentStatus, EquipmentDto["status"]>;

export class DrizzleEquipmentRepository implements EquipmentRepository {
  constructor(private readonly db: Db) {}

  async list(status?: EquipmentDto["status"]) {
    const query = this.db.select().from(equipment);

    const rows = await (status ? query.where(eq(equipment.status, toDb[status])) : query).orderBy(
      asc(equipment.tag),
    );

    return rows.map((r) => ({
      id: r.id,
      item: r.item,
      tag: r.tag,
      person: r.person,
      method: r.method,
      scheduledDate: r.scheduledDate,
      status: toDto[r.status],
    }));
  }
}
