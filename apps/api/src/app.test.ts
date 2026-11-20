import { describe, it, expect, beforeAll } from "vitest";
import { createTestDb } from "@offboard/db/testing";
import { createRepositories } from "@offboard/db";
import { createApp } from "./app.ts";

describe("health", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const db = await createTestDb();
    app = createApp(createRepositories(db));
  });

  it("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
