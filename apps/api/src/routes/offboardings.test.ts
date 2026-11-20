import { describe, it, expect, beforeAll } from "vitest";
import { z } from "zod";
import { createTestDb } from "@offboard/db/testing";
import { createRepositories } from "@offboard/db";
import { createApp } from "../app.ts";

const valid = { name: "Ana", role: "Engineer", department: "Eng", deadline: "2026-12-31" };

type Body = Partial<typeof valid> | Partial<typeof valid>[] | null;

const idBody = z.object({ id: z.uuid() });
const caseBody = z.object({ id: z.string(), tasks: z.array(z.unknown()) });

describe("offboardings", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    app = createApp(createRepositories(await createTestDb()));
  });

  const send = (path: string, body: string) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

  const post = (path: string, body: Body) => send(path, JSON.stringify(body));

  const create = async () => idBody.parse(await (await post("/offboardings", valid)).json());

  it("GET / returns an array", async () => {
    const res = await app.request("/offboardings");

    expect(res.status).toBe(200);
    expect(z.array(z.unknown()).safeParse(await res.json()).success).toBe(true);
  });

  it("POST / creates a case", async () => {
    const res = await post("/offboardings", valid);

    expect(res.status).toBe(201);
    expect(idBody.safeParse(await res.json()).success).toBe(true);
  });

  it("POST / rejects missing name", async () => {
    const { name: _n, ...rest } = valid;

    expect((await post("/offboardings", rest)).status).toBe(400);
  });

  it("POST / rejects invalid deadline", async () => {
    expect((await post("/offboardings", { ...valid, deadline: "not-a-date" })).status).toBe(400);
  });

  it("POST / rejects empty body, invalid json and null", async () => {
    expect((await post("/offboardings", {})).status).toBe(400);
    expect((await send("/offboardings", "not json")).status).toBe(400);
    expect((await post("/offboardings", null)).status).toBe(400);
  });

  it("GET /:id returns the created case with tasks", async () => {
    const { id } = await create();
    const res = await app.request(`/offboardings/${id}`);

    expect(res.status).toBe(200);
    expect(caseBody.parse(await res.json()).id).toBe(id);
  });

  it("GET /:id returns 404 for unknown uuid", async () => {
    const res = await app.request("/offboardings/00000000-0000-4000-8000-000000000000");

    expect(res.status).toBe(404);
  });

  it("GET /:id returns 404 for non-uuid", async () => {
    expect((await app.request("/offboardings/not-a-uuid")).status).toBe(404);
  });

  it("POST /bulk creates many", async () => {
    const res = await post("/offboardings/bulk", [valid, valid]);

    expect(res.status).toBe(200);
    expect(
      z
        .array(idBody)
        .length(2)
        .safeParse(await res.json()).success,
    ).toBe(true);
  });

  it("POST /bulk accepts empty array", async () => {
    const res = await post("/offboardings/bulk", []);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /bulk rejects non-array and invalid items", async () => {
    expect((await post("/offboardings/bulk", valid)).status).toBe(400);
    expect((await post("/offboardings/bulk", [valid, { name: "x" }])).status).toBe(400);
  });

  it("DELETE /:id returns 204 and removes the case", async () => {
    const { id } = await create();
    const res = await app.request(`/offboardings/${id}`, { method: "DELETE" });

    expect(res.status).toBe(204);
    expect((await app.request(`/offboardings/${id}`)).status).toBe(404);
  });
});
