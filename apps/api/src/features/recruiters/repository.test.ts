import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { recruiterPartners } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRecruitersRepository } from "./repository.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe.skipIf(!url)("recruiters repository", () => {
  const db = createClient(url ?? "");
  const recruiters = createRecruitersRepository(db);

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("creates a partner with a one-time token stored only as its hash", async () => {
    const now = new Date("2026-11-24T12:00:00.000Z");
    const { partner, token } = await recruiters.create({ name: "Ana", company: "Talentos" }, now);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(partner).toEqual({
      id: expect.any(String),
      name: "Ana",
      company: "Talentos",
      revokedAt: null,
      createdAt: now.toISOString(),
    });

    const [row] = await db
      .select({ tokenHash: recruiterPartners.tokenHash })
      .from(recruiterPartners)
      .where(eq(recruiterPartners.id, partner.id));

    expect(row.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(await recruiters.list())).not.toContain(row.tokenHash);
    expect(await recruiters.list()).toEqual([partner]);

    const other = await recruiters.create({ name: "Bruno", company: "Outra" }, now);

    expect(other.token).not.toBe(token);
  });

  it("finds active partners by token and refuses revoked or unknown ones", async () => {
    const [seeded] = await db
      .insert(recruiterPartners)
      .values({
        name: "Dev",
        company: "Local",
        tokenHash: sha256("dev-recruiter-token-offboard-local"),
      })
      .returning({ id: recruiterPartners.id });

    expect(await recruiters.byToken("dev-recruiter-token-offboard-local")).toEqual({
      id: seeded.id,
    });
    expect(await recruiters.byToken("unknown-token")).toBeUndefined();

    const revokedAt = new Date("2026-11-24T13:00:00.000Z");

    expect(await recruiters.revoke(seeded.id, revokedAt)).toBe(true);
    expect(await recruiters.byToken("dev-recruiter-token-offboard-local")).toBeUndefined();
    expect(await recruiters.revoke(seeded.id, new Date("2026-11-25T00:00:00.000Z"))).toBe(true);
    expect(await recruiters.list()).toMatchObject([
      { id: seeded.id, revokedAt: revokedAt.toISOString() },
    ]);
    expect(await recruiters.revoke(crypto.randomUUID(), revokedAt)).toBe(false);
  });

  it("lists partners oldest first with a missing creation time as null", async () => {
    await db.insert(recruiterPartners).values([
      { name: "B", company: "B", tokenHash: sha256("b"), createdAt: new Date("2026-02-01") },
      { name: "A", company: "A", tokenHash: sha256("a"), createdAt: new Date("2026-01-01") },
      { name: "C", company: "C", tokenHash: sha256("c"), createdAt: null },
    ]);

    expect(await recruiters.list()).toMatchObject([
      { name: "A", createdAt: "2026-01-01T00:00:00.000Z" },
      { name: "B", createdAt: "2026-02-01T00:00:00.000Z" },
      { name: "C", createdAt: null },
    ]);
  });
});
