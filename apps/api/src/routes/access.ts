import { Hono } from "hono";
import type { Repositories } from "@offboard/db";

export function accessRoutes(repos: Repositories) {
  const router = new Hono();

  router.get("/beneficiaries", async (c) => c.json(await repos.access.listBeneficiaries()));

  router.get("/team-members", async (c) => c.json(await repos.access.listTeamMembers()));

  return router;
}
