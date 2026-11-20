import { Hono } from "hono";
import { z } from "zod";
import type { Repositories } from "@offboard/db";

const query = z.object({
  status: z.enum(["connected", "disconnected"]).optional(),
});

export function integrationsRoutes(repos: Repositories) {
  const router = new Hono();

  router.get("/", async (c) => {
    const result = query.safeParse(c.req.query());

    if (!result.success) return c.json({ error: "invalid status" }, 400);

    return c.json(await repos.integrations.list(result.data.status));
  });

  return router;
}
