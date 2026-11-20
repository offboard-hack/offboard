import { Hono } from "hono";
import { z } from "zod";
import type { Repositories } from "@offboard/db";

const createInput = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  department: z.string().min(1),
  deadline: z.string().min(1),
});

const bulkInput = z.array(createInput);

async function readJson(req: Request) {
  return req.json().catch(() => null);
}

export function offboardingsRoutes(repos: Repositories) {
  const router = new Hono();

  router.get("/", async (c) => c.json(await repos.offboardings.list()));

  router.post("/bulk", async (c) => {
    const result = bulkInput.safeParse(await readJson(c.req.raw));

    if (!result.success) return c.json({ error: "invalid body" }, 400);

    return c.json(await repos.offboardings.createMany(result.data));
  });

  router.post("/", async (c) => {
    const result = createInput.safeParse(await readJson(c.req.raw));

    if (!result.success) return c.json({ error: "invalid body" }, 400);

    return c.json(await repos.offboardings.create(result.data), 201);
  });

  router.get("/:id", async (c) => {
    const found = await repos.offboardings.get(c.req.param("id"));

    if (!found) return c.json({ error: "not found" }, 404);

    return c.json(found);
  });

  router.delete("/:id", async (c) => {
    await repos.offboardings.delete(c.req.param("id"));

    return c.body(null, 204);
  });

  return router;
}
