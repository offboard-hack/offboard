import { createRequestScopedClient } from "@offboard/db/client";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { z } from "zod";
import { createApp } from "./app.js";
import { createAbacatePayGateway } from "./features/billing/abacatepay.js";
import { createRuntimeAuth } from "./features/auth/auth.js";
import { emailProvider, type CloudflareEmailBinding } from "./features/auth/email.js";
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
});

export type WorkerBindings = Partial<z.input<typeof runtimeConfig>> & {
  EMAIL?: CloudflareEmailBinding;
  HYPERDRIVE?: { connectionString: string };
};

export function createWorkerApi(bindings: WorkerBindings) {
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

  const { auth, origin } = createRuntimeAuth(db, repos.talent, undefined, {
    env: config.data,
    ipAddressHeaders: ["cf-connecting-ip"],
    cloudflareEmail: bindings.EMAIL,
  });

  const app = createApp(origin, repos, {
    adapter: CloudflareAdapter,
    auth,
    cronSecret: config.data.CRON_SECRET,
    webhookSecret: config.data.WEBHOOK_SECRET,
    slackSigningSecret: config.data.SLACK_SIGNING_SECRET,
    abacatepay: createAbacatePayGateway(config.data.ABACATEPAY_API_KEY),
    abacatepayWebhookSecret: config.data.ABACATEPAY_WEBHOOK_SECRET,
  }).compile();

  return (request: Request) => run(() => Promise.resolve(app.handle(request)));
}
