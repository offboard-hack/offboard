import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

function createPool(url: string) {
  const isCloud = url.includes("supabase") || url.includes("neon");
  const connStr = isCloud ? url.replace(/([?&])sslmode=[^&]*&?/g, "$1").replace(/[?&]$/, "") : url;
  const ssl = isCloud ? { rejectUnauthorized: false } : undefined;

  return new pg.Pool({ connectionString: connStr, ssl });
}

export function createClient(url: string) {
  return drizzle(createPool(url), { schema });
}

export function createRequestScopedClient(url: string) {
  const requestPool = new AsyncLocalStorage<pg.Pool>();

  const db = drizzle(
    new Proxy(createPool(url), {
      get(defaultPool, key: keyof pg.Pool) {
        if (key !== "connect" && key !== "query") return defaultPool[key];

        const pool = requestPool.getStore();

        if (!pool) throw new Error("Database access requires an active request");

        return pool[key].bind(pool);
      },
    }),
    { schema },
  );

  return {
    db,
    async run<T>(handle: () => Promise<T>) {
      const pool = createPool(url);

      try {
        return await requestPool.run(pool, handle);
      } finally {
        await pool.end();
      }
    },
  };
}

export type Database = ReturnType<typeof createClient>;
