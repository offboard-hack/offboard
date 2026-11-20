import { createClient } from "./client.ts";
import { runSeed } from "./run-seed.ts";

await runSeed(process.env.DATABASE_URL, createClient);
