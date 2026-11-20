import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Repositories } from "@offboard/db";
import { accessRoutes } from "./routes/access.ts";
import { billingRoutes } from "./routes/billing.ts";
import { checklistRoutes } from "./routes/checklist.ts";
import { equipmentRoutes } from "./routes/equipment.ts";
import { integrationsRoutes } from "./routes/integrations.ts";
import { offboardingsRoutes } from "./routes/offboardings.ts";
import { taskRoutes } from "./routes/tasks.ts";

export function createApp(repos: Repositories) {
  const app = new Hono();

  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/offboardings", offboardingsRoutes(repos));

  app.route("/", taskRoutes(repos));

  app.route("/equipment", equipmentRoutes(repos));

  app.route("/integrations", integrationsRoutes(repos));

  app.route("/access", accessRoutes(repos));

  app.route("/billing", billingRoutes(repos));

  app.route("/checklist", checklistRoutes(repos));

  return app;
}
