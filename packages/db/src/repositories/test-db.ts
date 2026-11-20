import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.ts";

export async function createTestDb() {
  const client = new PGlite();

  const { apply } = await pushSchema(schema, drizzle(client));

  await apply();

  return drizzle(client, { schema });
}
