import { createClient } from "@offboard/db/client";
import { createRepositories } from "@offboard/db/repositories";
import { sql } from "drizzle-orm";
import { createApp } from "./app.js";

const db = createClient(process.env.POSTGRES_URL ?? "");
const repos = createRepositories(db);
const app = createApp(process.env.WEB_ORIGIN ?? "*", repos);

let migrationResult = "pending";

async function ensureTeamTable() {
  await db.execute(
    sql.raw(
      "DO $$ BEGIN CREATE TYPE \"member_role\" AS ENUM ('admin', 'rh', 'gestor', 'visualizador'); EXCEPTION WHEN duplicate_object THEN NULL; END $$",
    ),
  );

  await db.execute(
    sql.raw(
      'CREATE TABLE IF NOT EXISTS "team_members" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "name" varchar(255) NOT NULL, "email" varchar(255) NOT NULL, "role" member_role NOT NULL, "created_at" timestamp DEFAULT now(), "updated_at" timestamp DEFAULT now(), CONSTRAINT "team_members_email_unique" UNIQUE("email"))',
    ),
  );
}

const migrated = ensureTeamTable()
  .then(() => {
    migrationResult = "ok";
  })
  .catch((err) => {
    migrationResult = `error: ${String(err)}`;
    console.error("Migration failed:", err);
  });

async function diag() {
  const parts: string[] = [`"migration":"${migrationResult}"`];

  try {
    const r = await db.execute(
      sql.raw("SELECT current_database(), current_user, current_schema()"),
    );

    parts.push(`"dbInfo":${JSON.stringify(r.rows)}`);
  } catch (err) {
    parts.push(`"dbInfo":"${String(err)}"`);
  }

  try {
    const r = await db.execute(
      sql.raw(
        "SELECT table_schema, column_name, udt_name FROM information_schema.columns WHERE table_name = 'team_members'",
      ),
    );

    parts.push(`"columns":${JSON.stringify(r.rows)}`);
  } catch (err) {
    parts.push(`"columns":"${String(err)}"`);
  }

  try {
    const r = await db.execute(
      sql.raw('SELECT "id", "name", "email", "role" FROM "team_members" ORDER BY "name" LIMIT 1'),
    );

    parts.push(`"select":"ok, rows=${String(r.rows.length)}"`);
  } catch (err) {
    parts.push(`"select":"${String(err)}"`);
  }

  return new Response(`{${parts.join(",")}}`, {
    headers: { "content-type": "application/json" },
  });
}

async function handle(request: Request) {
  await migrated;

  const url = new URL(request.url);

  if (url.pathname === "/api/_diag") {
    return diag();
  }

  return app.handle(request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
