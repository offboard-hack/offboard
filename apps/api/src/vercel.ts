import { createClient } from "@offboard/db/client";
import { node } from "@elysia/node";
import { sql } from "drizzle-orm";
import { createRepositories } from "./repositories.js";
import { createApp } from "./app.js";
import { createRuntimeAuth } from "./features/auth/auth.js";

const db = createClient(process.env.POSTGRES_URL ?? "");
const { auth, origin } = createRuntimeAuth(db, process.env.WEB_ORIGIN);

const app = createApp(origin, createRepositories(db), {
  adapter: node(),
  auth,
  cronSecret: process.env.CRON_SECRET,
  webhookSecret: process.env.WEBHOOK_SECRET,
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
});

async function ensureTeamTable() {
  const check = await db.execute(
    sql.raw(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'team_members' AND column_name = 'email'",
    ),
  );

  if (check.rows.length > 0) return;

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

const migrated = ensureTeamTable().catch((err) => {
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
