import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { describe, expect, it } from "vitest";
import { createClient, createRequestScopedClient } from "../src/client.ts";
import { offboardingCases, tasks } from "../src/schema/index.ts";
import { seedCases, seedDatabase } from "../src/seed-database.ts";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

it.skipIf(!url)(
  "allows queries and transactions only inside a database request scope",
  async () => {
    const { db, run } = createRequestScopedClient(() => url ?? "");
    const query = sql`select 1 as value`;

    expect(() => db.$client.query("select 1")).toThrow(
      "Database access requires an active request",
    );

    await run(async () => {
      expect((await db.execute(query)).rows).toEqual([{ value: 1 }]);
      await db.transaction(async (transaction) => {
        expect((await transaction.execute(query)).rows).toEqual([{ value: 1 }]);
      });
    });

    expect(() => db.$client.query("select 1")).toThrow(
      "Database access requires an active request",
    );
  },
);

it.skipIf(!url)("seeds the database with the example cases and tasks", async () => {
  const db = createClient(url ?? "");

  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    await seedDatabase(db);

    expect(await db.select().from(offboardingCases)).toHaveLength(seedCases.length);
    expect(await db.select().from(tasks)).toHaveLength(
      seedCases.reduce((sum, entry) => sum + entry.tasks.length, 0),
    );
  } finally {
    await db.$client.end();
  }
});

describe("createClient", () => {
  it("strips sslmode and disables certificate verification for cloud hosts", async () => {
    const cloud = createClient(
      "postgres://u:p@db.supabase.co:5432/db?sslmode=require&application_name=x",
    );

    const options = cloud.$client.options;
    expect(options.connectionString).toBe(
      "postgres://u:p@db.supabase.co:5432/db?application_name=x",
    );
    expect(options.ssl).toEqual({ rejectUnauthorized: false });
    await cloud.$client.end();

    const only = createClient("postgres://u:p@x.neon.tech/db?sslmode=require");
    expect(only.$client.options.connectionString).toBe("postgres://u:p@x.neon.tech/db");
    await only.$client.end();
  });

  it("leaves local urls untouched", async () => {
    const local = createClient("postgres://u:p@localhost:5432/db?sslmode=disable");
    expect(local.$client.options.connectionString).toBe(
      "postgres://u:p@localhost:5432/db?sslmode=disable",
    );
    expect(local.$client.options.ssl).toBeUndefined();
    await local.$client.end();
  });
});
