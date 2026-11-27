import { createClient } from "@offboard/db/client";
import { node } from "@elysia/node";
import { createRepositories } from "./repositories.js";
import { z } from "zod";
import { createApp } from "./app.js";
import { createAbacatePayGateway } from "./features/billing/abacatepay.js";
import { createRuntimeAuth } from "./features/auth/auth.js";
import { createGenerateStructured, resolveModel } from "./shared/ai.js";
import { diskStorage } from "./shared/disk-storage.js";
import { backofficeAccessFromEnv } from "./shared/staff-access.js";

const config = z
  .object({
    API_HOST: z.string().min(1).default("127.0.0.1"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    POSTGRES_URL: z.string().min(1),
    WEB_ORIGIN: z
      .url({ protocol: /^https?$/ })
      .transform((url) => new URL(url).origin)
      .default("http://localhost:5173"),
  })
  .parse(process.env);

const aiModel = resolveModel({
  gatewayKey: process.env.AI_GATEWAY_API_KEY,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
});

const db = createClient(config.POSTGRES_URL);
const repos = createRepositories(db);
const { auth, origin, sender } = createRuntimeAuth(db, repos.talent, config.WEB_ORIGIN);

createApp(origin, repos, {
  adapter: node(),
  auth,
  sendEmail: (message) => sender.send(message),
  cronSecret: process.env.CRON_SECRET,
  webhookSecret: process.env.WEBHOOK_SECRET,
  tracking: process.env.TRACKING_API_KEY
    ? {
        baseUrl: process.env.TRACKING_BASE_URL ?? "https://api.wonca.com.br",
        apiKey: process.env.TRACKING_API_KEY,
      }
    : undefined,
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
  secretKey: process.env.BETTER_AUTH_SECRET,
  abacatepay: createAbacatePayGateway(process.env.ABACATEPAY_API_KEY),
  abacatepayWebhookSecret: process.env.ABACATEPAY_WEBHOOK_SECRET,
  generateStructured: aiModel ? createGenerateStructured(aiModel) : undefined,
  storage: process.env.RESUME_STORAGE_DIR ? diskStorage(process.env.RESUME_STORAGE_DIR) : undefined,
  publicPageOrigin: process.env.PUBLIC_PAGE_ORIGIN,
  backofficeAccess: backofficeAccessFromEnv(process.env),
}).listen({
  hostname: config.API_HOST,
  reusePort: false,
  port: config.API_PORT,
});
