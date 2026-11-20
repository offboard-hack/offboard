import { describe, it, expect, beforeAll } from "vitest";
import { z } from "zod";
import { createTestDb } from "@offboard/db/testing";
import { createRepositories, integrations } from "@offboard/db";
import { createApp } from "../app.ts";

const rows = z.array(z.object({ name: z.string() }));

describe("integrations", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const db = await createTestDb();

    await db.insert(integrations).values([
      { name: "Slack", purpose: "chat", status: "connected" },
      { name: "Jira", purpose: "tickets", status: "disconnected" },
    ]);

    app = createApp(createRepositories(db));
  });

  it("GET / returns all integrations", async () => {
    const res = await app.request("/integrations");

    expect(res.status).toBe(200);
    expect(rows.parse(await res.json())).toHaveLength(2);
  });

  it("GET /?status=connected filters", async () => {
    const res = await app.request("/integrations?status=connected");

    expect(rows.parse(await res.json()).map((r) => r.name)).toEqual(["Slack"]);
  });

  it("GET /?status=bad returns 400", async () => {
    expect((await app.request("/integrations?status=bad")).status).toBe(400);
  });
});
