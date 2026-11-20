import { beforeEach, describe, expect, it } from "vitest";
import { checklistRules } from "../schema/index.ts";
import { DrizzleChecklistRepository } from "./checklist.ts";
import { createTestDb } from "./test-db.ts";

describe("DrizzleChecklistRepository", () => {
  let repo: DrizzleChecklistRepository;

  beforeEach(async () => {
    const db = await createTestDb();
    repo = new DrizzleChecklistRepository(db);
    await db.insert(checklistRules).values({
      title: "Revoke SSO",
      description: "d",
      team: "IT",
      timing: "day 0",
      required: true,
    });
  });

  it("lists rules", async () => {
    expect(await repo.list()).toEqual([
      expect.objectContaining({ title: "Revoke SSO", required: true, enabled: true }),
    ]);
  });

  it("ignores setEnabled with an invalid uuid", async () => {
    await expect(repo.setEnabled("abc", false)).resolves.toBeUndefined();
  });

  it("updates enabled", async () => {
    const [rule] = await repo.list();
    await repo.setEnabled(rule!.id, false);
    expect((await repo.list())[0]?.enabled).toBe(false);
  });
});
