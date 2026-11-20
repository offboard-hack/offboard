import { describe, it, expect, beforeAll } from "vitest";
import { z } from "zod";
import { createTestDb } from "@offboard/db/testing";
import { createRepositories, equipment } from "@offboard/db";
import { createApp } from "../app.ts";

const rows = z.array(z.object({ tag: z.string(), status: z.string() }));

describe("equipment", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const db = await createTestDb();

    await db.insert(equipment).values([
      { item: "Laptop", tag: "T-1", person: "Ana", method: "courier", status: "scheduled" },
      { item: "Phone", tag: "T-2", person: "Bob", method: "office", status: "with_person" },
    ]);

    app = createApp(createRepositories(db));
  });

  it("GET / returns all equipment", async () => {
    const res = await app.request("/equipment");

    expect(res.status).toBe(200);
    expect(rows.parse(await res.json())).toHaveLength(2);
  });

  it("GET /?status=scheduled filters", async () => {
    const res = await app.request("/equipment?status=scheduled");

    expect(rows.parse(await res.json()).map((r) => r.tag)).toEqual(["T-1"]);
  });

  it("GET /?status=withPerson filters", async () => {
    const res = await app.request("/equipment?status=withPerson");

    expect(res.status).toBe(200);
    expect(rows.parse(await res.json()).map((r) => r.tag)).toEqual(["T-2"]);
  });

  it("GET /?status=bogus returns 400", async () => {
    expect((await app.request("/equipment?status=bogus")).status).toBe(400);
  });
});
