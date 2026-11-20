import { Hono } from "hono";
import { z } from "zod";
import type { Repositories } from "@offboard/db";
import { isUuid, readJson } from "../util.ts";

const status = z.enum(["done", "inProgress", "todo"]);

const createInput = z.object({
  title: z.string().min(1),
  team: z.string().min(1),
  status: status.optional(),
});

const statusInput = z.object({ status });

const pgError = z.object({ code: z.string() });

function isForeignKeyViolation(error: Error) {
  return [error, error.cause].some((e) => {
    const parsed = pgError.safeParse(e);

    return parsed.success && parsed.data.code === "23503";
  });
}

export function taskRoutes(repos: Repositories) {
  const router = new Hono();

  router.get("/offboardings/:caseId/tasks", async (c) => {
    const caseId = c.req.param("caseId");

    if (!isUuid(caseId)) return c.json({ error: "not found" }, 404);

    return c.json(await repos.tasks.listByCase(caseId));
  });

  router.post("/offboardings/:caseId/tasks", async (c) => {
    const caseId = c.req.param("caseId");

    if (!isUuid(caseId)) return c.json({ error: "not found" }, 404);

    const result = createInput.safeParse(await readJson(c.req.raw));

    if (!result.success) return c.json({ error: "invalid body" }, 400);

    try {
      return c.json(await repos.tasks.create(caseId, result.data), 201);
    } catch (error) {
      if (error instanceof Error && isForeignKeyViolation(error)) {
        return c.json({ error: "not found" }, 404);
      }

      throw error;
    }
  });

  router.patch("/tasks/:id/status", async (c) => {
    const result = statusInput.safeParse(await readJson(c.req.raw));

    if (!result.success) return c.json({ error: "invalid body" }, 400);

    await repos.tasks.updateStatus(c.req.param("id"), result.data.status);

    return c.body(null, 204);
  });

  return router;
}
