import { Hono } from "hono";
import { z } from "zod";
import type { Repositories } from "@offboard/db";

const status = z.enum(["done", "inProgress", "todo"]);

const createInput = z.object({
  title: z.string().min(1),
  team: z.string().min(1),
  status: status.optional(),
});

const statusInput = z.object({ status });

const pgError = z.object({ code: z.string() });

async function readJson(req: Request) {
  return req.json().catch(() => null);
}

function isForeignKeyViolation(error: Error) {
  return [error, error.cause].some((e) => {
    const parsed = pgError.safeParse(e);

    return parsed.success && parsed.data.code === "23503";
  });
}

export function taskRoutes(repos: Repositories) {
  const router = new Hono();

  router.get("/offboardings/:caseId/tasks", async (c) =>
    c.json(await repos.tasks.listByCase(c.req.param("caseId"))),
  );

  router.post("/offboardings/:caseId/tasks", async (c) => {
    const result = createInput.safeParse(await readJson(c.req.raw));

    if (!result.success) return c.json({ error: "invalid body" }, 400);

    try {
      return c.json(await repos.tasks.create(c.req.param("caseId"), result.data), 201);
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
