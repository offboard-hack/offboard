import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Repositories } from "@offboard/db";
import { offboardingsRoutes } from "./routes/offboardings.ts";

export function createApp(repos: Repositories) {
  const app = new Hono();

  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.route("/offboardings", offboardingsRoutes(repos));

  return app;
}
