import { Hono } from "hono";
import { z } from "zod";
import type { Repositories } from "@offboard/db";

const patchInput = z.object({ enabled: z.boolean() });

async function readJson(req: Request) {
  return req.json().catch(() => null);
}

export function checklistRoutes(repos: Repositories) {
  const router = new Hono();

  router.get("/", async (c) => c.json(await repos.checklist.list()));

  router.patch("/:id", async (c) => {
    const result = patchInput.safeParse(await readJson(c.req.raw));

    if (!result.success) return c.json({ error: "invalid body" }, 400);

    await repos.checklist.setEnabled(c.req.param("id"), result.data.enabled);

    return c.body(null, 204);
  });

  return router;
}
