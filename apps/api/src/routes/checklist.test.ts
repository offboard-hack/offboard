import { describe, it, expect, beforeAll } from "vitest";
import { z } from "zod";
import { createTestDb } from "@offboard/db/testing";
import { checklistRules, createRepositories } from "@offboard/db";
import { createApp } from "../app.ts";

const rows = z.array(z.object({ id: z.string(), enabled: z.boolean() }));

describe("checklist", () => {
  let app: ReturnType<typeof createApp>;
  let id: string;

  beforeAll(async () => {
    const db = await createTestDb();

    const [row] = await db
      .insert(checklistRules)
      .values({ title: "Return laptop", description: "d", team: "IT", timing: "day 1" })
      .returning();

    id = z.object({ id: z.string() }).parse(row).id;
    app = createApp(createRepositories(db));
  });

  const patch = (body: string) =>
    app.request(`/checklist/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body,
    });

  it("GET / returns rules", async () => {
    const res = await app.request("/checklist");

    expect(res.status).toBe(200);
    expect(rows.parse(await res.json())).toHaveLength(1);
  });

  it("PATCH /:id toggles enabled", async () => {
    expect((await patch(JSON.stringify({ enabled: false }))).status).toBe(204);

    const list = rows.parse(await (await app.request("/checklist")).json());

    expect(list[0]?.enabled).toBe(false);
  });

  it("PATCH /:id rejects missing, non-boolean and invalid json", async () => {
    expect((await patch(JSON.stringify({}))).status).toBe(400);
    expect((await patch(JSON.stringify({ enabled: "yes" }))).status).toBe(400);
    expect((await patch("not json")).status).toBe(400);
  });
});
