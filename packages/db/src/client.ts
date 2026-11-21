import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

export function createClient(url: string) {
  const isCloud = url.includes("supabase") || url.includes("neon");
  const connStr = isCloud ? url.replace(/([?&])sslmode=[^&]*&?/g, "$1").replace(/[?&]$/, "") : url;
  const ssl = isCloud ? { rejectUnauthorized: false } : undefined;

  return drizzle(new pg.Pool({ connectionString: connStr, ssl }), { schema });
}

export type Database = ReturnType<typeof createClient>;
