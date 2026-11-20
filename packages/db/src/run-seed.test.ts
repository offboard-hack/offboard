import { describe, expect, it } from "vitest";
import { createTestDb } from "./repositories/test-db.ts";
import { offboardingCases } from "./schema/index.ts";
import { runSeed } from "./run-seed.ts";

describe("runSeed", () => {
  it("fails without a url", async () => {
    const db = await createTestDb();
    const connect = () => Object.assign(db, { $client: { end: async () => {} } });

    await expect(runSeed(undefined, connect)).rejects.toThrow("DATABASE_URL is required");
  });

  it("seeds and closes the connection", async () => {
    const db = await createTestDb();

    const closed: string[] = [];

    const connect = (url: string) => {
      const end = async () => {
        closed.push(url);
      };

      return Object.assign(db, { $client: { end } });
    };

    await runSeed("postgres://x", connect);

    expect(closed).toEqual(["postgres://x"]);
    expect(await db.select().from(offboardingCases)).toHaveLength(5);
  });
});
