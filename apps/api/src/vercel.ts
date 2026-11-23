import { createClient } from "@offboard/db/client";
import { createRepositories } from "@offboard/db/repositories";
import { sql } from "drizzle-orm";
import { createApp } from "./app.js";

const db = createClient(process.env.POSTGRES_URL ?? "");
const repos = createRepositories(db);
const app = createApp(process.env.WEB_ORIGIN ?? "*", repos);

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
