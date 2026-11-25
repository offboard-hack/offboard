import { createClient } from "@offboard/db/client";
import { node } from "@elysia/node";
import { sql } from "drizzle-orm";
import { createRepositories } from "./repositories.js";
import { createApp } from "./app.js";
import { createAbacatePayGateway } from "./features/billing/abacatepay.js";
import { createRuntimeAuth } from "./features/auth/auth.js";
import { createGenerateStructured, gatewayModel } from "./shared/ai.js";
import { diskStorage } from "./shared/disk-storage.js";
import type { WelcomeMessage } from "./features/talent/welcome.js";
import type { PortalAuth } from "./shared/portal-auth.js";

const db = createClient(process.env.POSTGRES_URL ?? "");
const repos = createRepositories(db);

const noopAuth: PortalAuth = {
  handler: () => Promise.resolve(new Response("Auth not configured", { status: 501 })),
  resolvePrincipal: () =>
    Promise.resolve({
      kind: "authenticated",
      principal: { id: "system", name: "System", email: "system@offboard.app", role: "admin" },
    }),
};

function buildApp() {
  let auth: PortalAuth;
  let origin: string;
  let sendEmail: (message: WelcomeMessage) => Promise<void>;

  try {
    const runtime = createRuntimeAuth(db, repos.talent, process.env.WEB_ORIGIN);
    auth = runtime.auth;
    origin = runtime.origin;
    sendEmail = (message) => runtime.sender.send(message);
  } catch {
    auth = noopAuth;
    origin = process.env.WEB_ORIGIN ?? "*";
    sendEmail = () => Promise.reject(new Error("Email not configured"));
  }

  return createApp(origin, repos, {
    adapter: node(),
    auth,
    sendEmail,
    cronSecret: process.env.CRON_SECRET,
    webhookSecret: process.env.WEBHOOK_SECRET,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    abacatepay: createAbacatePayGateway(process.env.ABACATEPAY_API_KEY),
    abacatepayWebhookSecret: process.env.ABACATEPAY_WEBHOOK_SECRET,
    generateStructured: process.env.AI_GATEWAY_API_KEY
      ? createGenerateStructured(gatewayModel(process.env.AI_GATEWAY_API_KEY))
      : undefined,
    storage: process.env.RESUME_STORAGE_DIR
      ? diskStorage(process.env.RESUME_STORAGE_DIR)
      : undefined,
    publicPageOrigin: process.env.PUBLIC_PAGE_ORIGIN,
  });
}

const app = buildApp();

async function ensureSchema() {
  const cols = await db.execute(
    sql.raw(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('team_members', 'tasks')",
    ),
  );

  const has = (table: string, col: string) =>
    cols.rows.some((r) => r.table_name === table && r.column_name === col);

  if (!has("team_members", "email")) {
    await db.execute(sql.raw('DROP TABLE IF EXISTS "team_members"'));
    await db.execute(sql.raw('DROP TYPE IF EXISTS "member_role"'));
    await db.execute(
      sql.raw("CREATE TYPE \"member_role\" AS ENUM ('admin', 'rh', 'gestor', 'visualizador')"),
    );
    await db.execute(
      sql.raw(
        'CREATE TABLE "team_members" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "name" varchar(255) NOT NULL, "email" varchar(255) NOT NULL, "role" member_role NOT NULL, "created_at" timestamp DEFAULT now(), "updated_at" timestamp DEFAULT now(), CONSTRAINT "team_members_email_unique" UNIQUE("email"))',
      ),
    );
  }

  await db.execute(
    sql.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS "team_members_email_lower_idx" ON "team_members" (lower("email"))',
    ),
  );

  if (!has("tasks", "phase")) {
    await db.execute(sql.raw('ALTER TABLE "tasks" ADD COLUMN "phase" varchar(50)'));
  }

  if (!has("tasks", "tracking_code")) {
    await db.execute(sql.raw('ALTER TABLE "tasks" ADD COLUMN "tracking_code" varchar(30)'));
  }

  const authTables = await db.execute(
    sql.raw(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'auth_user'",
    ),
  );

  if (authTables.rows.length === 0) {
    await db.execute(
      sql.raw(`
        CREATE TABLE "auth_user" ("id" text PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "email_verified" boolean NOT NULL DEFAULT false, "image" text, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now());
        CREATE TABLE "auth_session" ("id" text PRIMARY KEY, "token" text NOT NULL UNIQUE, "user_id" text NOT NULL REFERENCES "auth_user"("id") ON DELETE CASCADE, "member_id" uuid NOT NULL, "expires_at" timestamp NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(), "ip_address" text, "user_agent" text);
        CREATE INDEX "auth_session_user_id_idx" ON "auth_session" ("user_id");
        CREATE TABLE "auth_account" ("id" text PRIMARY KEY, "account_id" text NOT NULL, "provider_id" text NOT NULL, "user_id" text NOT NULL REFERENCES "auth_user"("id") ON DELETE CASCADE, "access_token" text, "refresh_token" text, "id_token" text, "access_token_expires_at" timestamp, "refresh_token_expires_at" timestamp, "scope" text, "password" text, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now());
        CREATE INDEX "auth_account_user_id_idx" ON "auth_account" ("user_id");
        CREATE TABLE "auth_verification" ("id" text PRIMARY KEY, "identifier" text NOT NULL, "value" text NOT NULL, "expires_at" timestamp NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now());
        CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" ("identifier");
        CREATE TABLE "auth_rate_limit" ("id" text PRIMARY KEY, "key" text NOT NULL UNIQUE, "count" integer NOT NULL, "last_request" bigint NOT NULL);
      `),
    );
  }
}

const migrated = ensureSchema().catch((err) => {
  console.error("Migration failed:", err);
});

async function handle(request: Request) {
  await migrated;

  return app.handle(request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
