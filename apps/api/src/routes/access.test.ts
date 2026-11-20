import { describe, it, expect, beforeAll } from "vitest";
import { z } from "zod";
import { createTestDb } from "@offboard/db/testing";
import { beneficiaries, createRepositories, teamMembers } from "@offboard/db";
import { createApp } from "../app.ts";

const rows = z.array(z.object({ name: z.string() }));

describe("access", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const db = await createTestDb();

    await db
      .insert(beneficiaries)
      .values({ name: "Ana", plan: "Pro", status: "active", accessUntil: "2027-01-01" });
    await db
      .insert(teamMembers)
      .values({ name: "Bob", role: "Admin", accessScope: "all", securityStatus: "ok" });

    app = createApp(createRepositories(db));
  });

  it("GET /beneficiaries returns beneficiaries", async () => {
    const res = await app.request("/access/beneficiaries");

    expect(res.status).toBe(200);
    expect(rows.parse(await res.json()).map((r) => r.name)).toEqual(["Ana"]);
  });

  it("GET /team-members returns team members", async () => {
    const res = await app.request("/access/team-members");

    expect(res.status).toBe(200);
    expect(rows.parse(await res.json()).map((r) => r.name)).toEqual(["Bob"]);
  });
});
