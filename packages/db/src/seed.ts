import { createClient } from "./client.ts";
import { seedDatabase } from "./seed-database.ts";

const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createClient(url);

try {
  await seedDatabase(db);
  console.log("Seed complete");
} finally {
  await db.$client.end();
}
