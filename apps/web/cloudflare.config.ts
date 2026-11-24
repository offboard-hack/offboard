import { bindings, defineConfig, triggers, type WorkerConfig } from "cf/config";
import { z } from "zod";
import * as entrypoint from "./cloudflare.worker.ts" with { type: "cf-worker" };

const apiConfigured = process.env.OFFBOARD_API_CONFIGURED === "1";
const cronEnabled = apiConfigured && process.env.OFFBOARD_ENABLE_CRON === "1";
const hyperdriveId = process.env.OFFBOARD_HYPERDRIVE_ID;

const provider = z
  .enum(["resend", "cloudflare"])
  .default("resend")
  .parse(process.env.EMAIL_PROVIDER);

const env: NonNullable<WorkerConfig["env"]> = { EMAIL_PROVIDER: bindings.text(provider) };

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

  if (cronEnabled) env.CRON_SECRET = bindings.secret();
}

export default defineConfig({
  worker: {
    name: "offboard-preview",
    entrypoint,
    compatibilityDate: "2026-11-23",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: true,
    domains: ["app.off-board.xyz"],
    env,
    triggers: cronEnabled ? [triggers.scheduled({ schedule: "0 */4 * * *" })] : [],
  },
});
