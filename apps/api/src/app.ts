import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Repositories } from "@offboard/db";

export function createApp(_repos: Repositories) {
  const app = new Hono();

  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}
