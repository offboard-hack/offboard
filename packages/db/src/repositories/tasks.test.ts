import { beforeEach, describe, expect, it } from "vitest";
import { DrizzleOffboardingRepository } from "./offboarding.ts";
import { DrizzleTaskRepository } from "./tasks.ts";
import { createTestDb } from "./test-db.ts";

describe("DrizzleTaskRepository", () => {
  let repo: DrizzleTaskRepository;
  let caseId: string;

  beforeEach(async () => {
    const db = await createTestDb();
    repo = new DrizzleTaskRepository(db);
    ({ id: caseId } = await new DrizzleOffboardingRepository(db).create({
      name: "Ana",
      role: "Dev",
      department: "Eng",
      deadline: "2026-12-01",
    }));
  });

  it("creates with default todo status and lists", async () => {
    const { id } = await repo.create(caseId, { title: "a", team: "IT" });
    expect(await repo.listByCase(caseId)).toEqual([
      { id, caseId, title: "a", team: "IT", status: "todo" },
    ]);
  });

  it("maps inProgress on create and update", async () => {
    const { id } = await repo.create(caseId, { title: "a", team: "IT", status: "inProgress" });
    expect((await repo.listByCase(caseId))[0]?.status).toBe("inProgress");
    await repo.updateStatus(id, "done");
    expect((await repo.listByCase(caseId))[0]?.status).toBe("done");
    await repo.updateStatus(id, "inProgress");
    expect((await repo.listByCase(caseId))[0]?.status).toBe("inProgress");
  });
});
