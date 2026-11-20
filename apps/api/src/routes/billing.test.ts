import { describe, it, expect, beforeAll } from "vitest";
import { z } from "zod";
import { createTestDb } from "@offboard/db/testing";
import { createRepositories, plans } from "@offboard/db";
import { createApp } from "../app.ts";

const rows = z.array(z.object({ name: z.string() }));

describe("billing", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const db = await createTestDb();

    await db
      .insert(plans)
      .values({ name: "Pro", priceCents: 1000, capacity: 10, costCenter: "eng" });

    app = createApp(createRepositories(db));
  });

  it("GET /plans returns plans", async () => {
    const res = await app.request("/billing/plans");

    expect(res.status).toBe(200);
    expect(rows.parse(await res.json()).map((r) => r.name)).toEqual(["Pro"]);
  });
});
