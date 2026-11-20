import type { Db } from "./repositories/tasks.ts";
import { seed } from "./seed.ts";

type SeedClient = Db & { $client: { end(): Promise<void> } };

export async function runSeed(url: string | undefined, connect: (url: string) => SeedClient) {
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const db = connect(url);

  try {
    await seed(db);
  } finally {
    await db.$client.end();
  }
}
