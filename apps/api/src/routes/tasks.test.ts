import { describe, it, expect, beforeAll } from "vitest";
import { z } from "zod";
import { createTestDb } from "@offboard/db/testing";
import { createRepositories } from "@offboard/db";
import { createApp } from "../app.ts";

const valid = { name: "Ana", role: "Engineer", department: "Eng", deadline: "2026-12-31" };
const missingCase = "00000000-0000-4000-8000-000000000000";

type TaskBody = { title?: string; team?: string; status?: string };

const idBody = z.object({ id: z.uuid() });
const taskList = z.array(z.object({ id: z.string(), title: z.string(), status: z.string() }));

describe("tasks", () => {
  let app: ReturnType<typeof createApp>;
  let caseId: string;

  beforeAll(async () => {
    const repos = createRepositories(await createTestDb());
    app = createApp(repos);
    caseId = (await repos.offboardings.create(valid)).id;
  });

  const send = (method: string, path: string, body: string) =>
    app.request(path, { method, headers: { "content-type": "application/json" }, body });

  const addTask = (path: string, body: TaskBody) => send("POST", path, JSON.stringify(body));

  const createTask = async (title: string) => {
    const res = await addTask(`/offboardings/${caseId}/tasks`, { title, team: "IT" });

    return idBody.parse(await res.json());
  };

  const listTasks = async () => {
    const res = await app.request(`/offboardings/${caseId}/tasks`);

    return taskList.parse(await res.json());
  };

  const patchStatus = (id: string, body: string) => send("PATCH", `/tasks/${id}/status`, body);

  it("POST creates a task and returns 201", async () => {
    const res = await addTask(`/offboardings/${caseId}/tasks`, {
      title: "Badge",
      team: "Security",
      status: "inProgress",
    });

    expect(res.status).toBe(201);
    expect(idBody.safeParse(await res.json()).success).toBe(true);
  });

  it("GET lists tasks ordered by position", async () => {
    await createTask("First");
    await createTask("Second");
    const titles = (await listTasks()).map((t) => t.title);

    expect(titles.indexOf("Second")).toBeGreaterThan(titles.indexOf("First"));
  });

  it("POST rejects missing title, invalid json and bad status", async () => {
    const path = `/offboardings/${caseId}/tasks`;

    expect((await addTask(path, { team: "IT" })).status).toBe(400);
    expect((await send("POST", path, "not json")).status).toBe(400);
    expect((await addTask(path, { title: "x", team: "IT", status: "nope" })).status).toBe(400);
  });

  it("POST returns 404 for a nonexistent case", async () => {
    const res = await addTask(`/offboardings/${missingCase}/tasks`, { title: "x", team: "IT" });

    expect(res.status).toBe(404);
  });

  it("POST propagates errors that are not FK violations", async () => {
    const res = await addTask("/offboardings/not-a-uuid/tasks", { title: "x", team: "IT" });

    expect(res.status).toBe(500);
  });

  it("PATCH updates status and returns 204", async () => {
    const { id } = await createTask("Patch me");
    const res = await patchStatus(id, JSON.stringify({ status: "done" }));

    expect(res.status).toBe(204);
    expect((await listTasks()).find((t) => t.id === id)?.status).toBe("done");
  });

  it("PATCH rejects invalid status and invalid json", async () => {
    const { id } = await createTask("Reject");

    expect((await patchStatus(id, JSON.stringify({ status: "nope" }))).status).toBe(400);
    expect((await patchStatus(id, "not json")).status).toBe(400);
  });

  it("PATCH with a non-uuid id returns 204", async () => {
    expect((await patchStatus("not-a-uuid", JSON.stringify({ status: "todo" }))).status).toBe(204);
  });
});
