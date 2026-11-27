import type { Database } from "@offboard/db/client";
import { equipment } from "@offboard/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

export function normalizeHolderEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function attachWaitingEquipment(
  db: Pick<Database, "update">,
  orgId: string,
  caseId: string,
  emails: (string | null | undefined)[],
) {
  const keys = emails.flatMap((email) => (email ? normalizeHolderEmail(email) : []));

  if (!keys.length) return;

  await db
    .update(equipment)
    .set({ caseId, holderEmail: null, updatedAt: new Date() })
    .where(
      and(
        eq(equipment.orgId, orgId),
        isNull(equipment.caseId),
        inArray(sql`lower(${equipment.holderEmail})`, keys),
      ),
    );
}
