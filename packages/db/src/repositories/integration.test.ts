import { beforeEach, describe, expect, it } from "vitest";
import { integrations } from "../schema/index.ts";
import { DrizzleIntegrationRepository } from "./integration.ts";
import { createTestDb } from "./test-db.ts";

describe("DrizzleIntegrationRepository", () => {
  let repo: DrizzleIntegrationRepository;

  beforeEach(async () => {
    const db = await createTestDb();
    repo = new DrizzleIntegrationRepository(db);
    await db.insert(integrations).values([
      { name: "Slack", purpose: "chat", status: "connected", lastActivity: "today" },
      { name: "Jira", purpose: "tickets", status: "disconnected" },
    ]);
  });

  it("lists all", async () => {
    expect(await repo.list()).toEqual([
      expect.objectContaining({ name: "Jira", status: "disconnected", lastActivity: null }),
      expect.objectContaining({ name: "Slack", status: "connected", lastActivity: "today" }),
    ]);
  });

  it("filters by status", async () => {
    expect((await repo.list("connected")).map((r) => r.name)).toEqual(["Slack"]);
  });
});
