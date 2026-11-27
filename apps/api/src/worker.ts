import { createRequestScopedClient } from "@offboard/db/client";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { z } from "zod";
import { createApp } from "./app.js";
import { createAbacatePayGateway } from "./features/billing/abacatepay.js";
import { createRuntimeAuth } from "./features/auth/auth.js";
import { emailProvider, type CloudflareEmailBinding } from "./features/auth/email.js";
import { browserbaseConfig } from "./shared/ai-apply-access.js";
import { createGenerateStructured, resolveModel } from "./shared/ai.js";
import { workersAiEmbed, type WorkersAi } from "./shared/embed.js";
import { r2Storage, type R2BucketLike } from "./shared/object-storage.js";
import { createRepositories } from "./repositories.js";

const runtimeConfig = z.object({
  POSTGRES_URL: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  EMAIL_PROVIDER: emailProvider,
  RESEND_API_KEY: z.string().min(1).optional(),
  AUTH_EMAIL_FROM: z.string().min(1),
  CRON_SECRET: z.string().min(1).optional(),
  WEBHOOK_SECRET: z.string().min(1).optional(),
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),
  ABACATEPAY_API_KEY: z.string().min(1).optional(),
  ABACATEPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  BROWSERBASE_API_KEY: z.string().min(1).optional(),
  BROWSERBASE_PROJECT_ID: z.string().min(1).optional(),
  PUBLIC_PAGE_ORIGIN: z.string().min(1).optional(),
  TRACKING_API_KEY: z.string().min(1).optional(),
  TRACKING_BASE_URL: z.string().min(1).optional(),
});

export type WorkerBindings = Partial<z.input<typeof runtimeConfig>> & {
  EMAIL?: CloudflareEmailBinding;
  HYPERDRIVE?: { connectionString: string };
  RESUMES?: R2BucketLike;
  AI?: WorkersAi;
};

export function createWorkerApi(
  bindings: WorkerBindings,
  waitUntil: (task: Promise<unknown>) => void,
) {
  const config = runtimeConfig.safeParse(bindings);
  const hyperdrive = bindings.HYPERDRIVE;
  const directUrl = config.data?.POSTGRES_URL;

  const getDatabaseUrl = hyperdrive
    ? () => hyperdrive.connectionString
    : directUrl && (() => directUrl);

  if (!config.success || !getDatabaseUrl) {
    return async (request: Request) => {
      const session = request.method === "GET" && new URL(request.url).pathname === "/api/session";

      return Response.json(
        { error: session ? "Unauthorized" : "Offboard API is not configured" },
        { status: session ? 401 : 503, headers: { "Cache-Control": "private, no-store" } },
      );
    };
  }

  const { db, run } = createRequestScopedClient(getDatabaseUrl);
  const repos = createRepositories(db);

  const { auth, origin, sender } = createRuntimeAuth(db, repos.talent, undefined, {
    env: config.data,
    ipAddressHeaders: ["cf-connecting-ip"],
    cloudflareEmail: bindings.EMAIL,
    deferMagicLinkDelivery: waitUntil,
  });

  const aiModel = resolveModel({
    gatewayKey: config.data.AI_GATEWAY_API_KEY,
    anthropicKey: config.data.ANTHROPIC_API_KEY,
  });

  const app = createApp(origin, repos, {
    adapter: CloudflareAdapter,
    auth,
    sendEmail: (message) => sender.send(message),
    cronSecret: config.data.CRON_SECRET,
    webhookSecret: config.data.WEBHOOK_SECRET,
    tracking: config.data.TRACKING_API_KEY
      ? {
          baseUrl: config.data.TRACKING_BASE_URL ?? "https://api.wonca.com.br",
          apiKey: config.data.TRACKING_API_KEY,
        }
      : undefined,
    slackSigningSecret: config.data.SLACK_SIGNING_SECRET,
    secretKey: config.data.BETTER_AUTH_SECRET,
    abacatepay: createAbacatePayGateway(config.data.ABACATEPAY_API_KEY),
    abacatepayWebhookSecret: config.data.ABACATEPAY_WEBHOOK_SECRET,
    generateStructured: aiModel ? createGenerateStructured(aiModel) : undefined,
    embed: bindings.AI && workersAiEmbed(bindings.AI),
    embedProfile: bindings.AI && workersAiEmbed(bindings.AI),
    storage: bindings.RESUMES && r2Storage(bindings.RESUMES),
    publicPageOrigin: config.data.PUBLIC_PAGE_ORIGIN,
    browserbase: browserbaseConfig(
      config.data.BROWSERBASE_API_KEY,
      config.data.BROWSERBASE_PROJECT_ID,
    ),
    runInBackground: (task) => {
      const background = run(task).catch(() => undefined);

      waitUntil(background);
    },
  }).compile();

  return (request: Request) => run(() => Promise.resolve(app.handle(request)));
}
