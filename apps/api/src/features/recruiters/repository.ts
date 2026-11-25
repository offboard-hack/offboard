import type { Database } from "@offboard/db/client";
import { recruiterPartners } from "@offboard/db/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

export type PartnerView = {
  id: string;
  name: string;
  company: string;
  revokedAt: string | null;
  createdAt: string | null;
};

const partnerColumns = {
  id: recruiterPartners.id,
  name: recruiterPartners.name,
  company: recruiterPartners.company,
  revokedAt: recruiterPartners.revokedAt,
  createdAt: recruiterPartners.createdAt,
};

type PartnerRow = {
  id: string;
  name: string;
  company: string;
  revokedAt: Date | null;
  createdAt: Date | null;
};

const toView = (row: PartnerRow) =>
  ({
    ...row,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString() ?? null,
  }) satisfies PartnerView;

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createRecruitersRepository(db: Database) {
  async function list() {
    const rows = await db
      .select(partnerColumns)
      .from(recruiterPartners)
      .orderBy(sql`${recruiterPartners.createdAt} asc nulls last`, asc(recruiterPartners.id));

    return rows.map(toView);
  }

  async function create(input: { name: string; company: string }, now: Date) {
    const token = newToken();

    const [row] = await db
      .insert(recruiterPartners)
      .values({
        name: input.name,
        company: input.company,
        tokenHash: await tokenHash(token),
        createdAt: now,
        updatedAt: now,
      })
      .returning(partnerColumns);

    return { partner: toView(row), token };
  }

  async function revoke(id: string, now: Date) {
    const rows = await db
      .update(recruiterPartners)
      .set({
        revokedAt: sql`coalesce(${recruiterPartners.revokedAt}, ${now.toISOString()}::timestamp)`,
        updatedAt: now,
      })
      .where(eq(recruiterPartners.id, id))
      .returning({ id: recruiterPartners.id });

    return rows.length > 0;
  }

  async function byToken(token: string) {
    const [row] = await db
      .select({ id: recruiterPartners.id })
      .from(recruiterPartners)
      .where(
        and(
          eq(recruiterPartners.tokenHash, await tokenHash(token)),
          isNull(recruiterPartners.revokedAt),
        ),
      );

    return row;
  }

  return { list, create, revoke, byToken };
}

export type RecruitersRepository = ReturnType<typeof createRecruitersRepository>;
