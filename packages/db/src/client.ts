import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

export function createClient(url: string) {
  return drizzle(new pg.Pool({ connectionString: url }), { schema });
}

export type Database = ReturnType<typeof createClient>;
