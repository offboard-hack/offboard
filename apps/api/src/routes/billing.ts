import { Hono } from "hono";
import type { Repositories } from "@offboard/db";

export function billingRoutes(repos: Repositories) {
  const router = new Hono();

  router.get("/plans", async (c) => c.json(await repos.billing.listPlans()));

  return router;
}
