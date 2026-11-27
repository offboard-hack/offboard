import { randomUUID } from "node:crypto";
import { createClient } from "@offboard/db/client";
import { seedCatalog } from "@offboard/db/seed-database";
import { latestCode, outboxPath, readOutbox } from "../shared/dev-outbox.js";
import { assertLocalTargets, parseArgs } from "./args.js";
import { createHttp } from "./http.js";
import { runScenario } from "./run.js";

const args = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("POSTGRES_URL or DATABASE_URL is required to seed the catalog");

assertLocalTargets({ baseUrl: args.baseUrl, databaseUrl, allowRemote: args.allowRemote });

const db = createClient(databaseUrl);
const outbox = outboxPath(process.env);

try {
  await runScenario(args.name, {
    http: createHttp(fetch, args.baseUrl, args.webOrigin),
    env: process.env,
    webOrigin: args.webOrigin,
    async readCode(email) {
      const code = latestCode(readOutbox(outbox), email);

      if (!code) {
        throw new Error(
          `No sign-in code for ${email} in ${outbox}. Start the API with EMAIL_PROVIDER=console.`,
        );
      }

      return code;
    },
    seedCatalog: () => seedCatalog(db),
    newId: randomUUID,
    today: () => new Date().toISOString().slice(0, 10),
    log: (line) => console.log(line),
    sessions: new Map(),
    logins: [],
  });
} finally {
  await db.$client.end();
}
