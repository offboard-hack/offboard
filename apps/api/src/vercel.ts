import { createClient } from "@offboard/db/client";
import { createRepositories } from "@offboard/db/repositories";
import { sql } from "drizzle-orm";
import { createApp } from "./app.js";

const db = createClient(process.env.POSTGRES_URL ?? "");
const repos = createRepositories(db);
const app = createApp(process.env.WEB_ORIGIN ?? "*", repos);

async function ensureTeamTable() {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "member_role" AS ENUM ('admin', 'rh', 'gestor', 'visualizador');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "team_members" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "name" varchar(255) NOT NULL,
      "email" varchar(255) NOT NULL,
      "role" member_role NOT NULL,
      "created_at" timestamp DEFAULT now(),
      "updated_at" timestamp DEFAULT now(),
      CONSTRAINT "team_members_email_unique" UNIQUE("email")
    )
  `);
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
