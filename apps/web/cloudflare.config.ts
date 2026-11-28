import { bindings, defineConfig, triggers, type WorkerConfig } from "cf/config";
import { z } from "zod";
import * as entrypoint from "./cloudflare.worker.ts" with { type: "cf-worker" };
import { cronSchedules } from "./src/cron-schedules.ts";

const apiConfigured = process.env.OFFBOARD_API_CONFIGURED === "1";
const cronEnabled = apiConfigured && process.env.OFFBOARD_ENABLE_CRON === "1";
const hyperdriveId = process.env.OFFBOARD_HYPERDRIVE_ID;
const hyperdriveRegion = process.env.OFFBOARD_HYPERDRIVE_REGION;

const provider = z
  .enum(["resend", "cloudflare"])
  .default("resend")
  .parse(process.env.EMAIL_PROVIDER);

const appDomain = "app.off-board.xyz";

const env: NonNullable<WorkerConfig["env"]> = {
  EMAIL_PROVIDER: bindings.text(provider),
  ASSETS: bindings.assets(),
};

if (provider === "cloudflare") env.EMAIL = bindings.sendEmail();

if (hyperdriveId) env.HYPERDRIVE = bindings.hyperdrive({ id: hyperdriveId });

if (apiConfigured) {
  Object.assign(env, {
    BETTER_AUTH_URL: bindings.secret(),
    BETTER_AUTH_SECRET: bindings.secret(),
    AUTH_EMAIL_FROM: bindings.secret(),
  });

  if (!hyperdriveId) env.POSTGRES_URL = bindings.secret();

  if (provider === "resend") env.RESEND_API_KEY = bindings.secret();

  if (process.env.OFFBOARD_AI_CONFIGURED === "1") env.AI_GATEWAY_API_KEY = bindings.secret();

  if (process.env.OFFBOARD_AI_CONFIGURED === "anthropic") env.ANTHROPIC_API_KEY = bindings.secret();

  if (process.env.OFFBOARD_AI_APPLY_CONFIGURED === "1") {
    env.BROWSERBASE_API_KEY = bindings.secret();
    env.BROWSERBASE_PROJECT_ID = bindings.secret();
  }

  if (process.env.OFFBOARD_RESUMES_BUCKET) {
    env.RESUMES = bindings.r2({ name: process.env.OFFBOARD_RESUMES_BUCKET });
  }

  env.AI = bindings.ai();

  if (cronEnabled) env.CRON_SECRET = bindings.secret();

  env.TRACKING_API_KEY = bindings.secret();
  env.TRACKING_BASE_URL = bindings.secret();
  env.BACKOFFICE_STAFF_EMAILS = bindings.secret();
  env.ABACATEPAY_API_KEY = bindings.secret();
  env.ABACATEPAY_WEBHOOK_SECRET = bindings.secret();
  env.TURNSTILE_SITE_KEY = bindings.secret();
  env.TURNSTILE_SECRET_KEY = bindings.secret();
}

export default defineConfig({
  worker: {
    name: "offboard-preview",
    entrypoint,
    compatibilityDate: "2026-11-23",
    compatibilityFlags: ["nodejs_compat"],
    placement: hyperdriveId && hyperdriveRegion ? { region: hyperdriveRegion } : undefined,
    workersDev: true,
    domains: [appDomain],
    env,
    triggers: cronEnabled
      ? Object.values(cronSchedules).map((schedule) => triggers.scheduled({ schedule }))
      : [],
  },
});
