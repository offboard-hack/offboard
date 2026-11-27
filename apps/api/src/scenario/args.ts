import { z } from "zod";

export const scenarioNames = [
  "orgs",
  "add-person",
  "company-payment",
  "career",
  "offboarding",
  "applications",
  "answers",
  "benefits-manual",
  "equipment",
  "integrations",
  "checklist-actions",
  "all",
] as const;

const scenarioName = z.enum(scenarioNames);

export type ScenarioName = z.infer<typeof scenarioName>;

const options = z.object({
  baseUrl: z.url().default("http://127.0.0.1:3001"),
  webOrigin: z.url().default("http://localhost:5173"),
});

export function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  const positional: string[] = [];
  let allowRemote = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--allow-remote") {
      allowRemote = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const next = argv[index + 1];

    if (next === undefined || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    values.set(arg.slice(2), next);
    index += 1;
  }

  const name = scenarioName.safeParse(positional[0]);

  if (!name.success || positional.length > 1) {
    throw new Error(
      `Usage: npm run scenario -- <${scenarioNames.join("|")}> [--base-url URL] [--web-origin URL] [--allow-remote]`,
    );
  }

  const parsed = options.parse({
    baseUrl: values.get("base-url"),
    webOrigin: values.get("web-origin"),
  });

  return {
    name: name.data,
    baseUrl: new URL(parsed.baseUrl).origin,
    webOrigin: new URL(parsed.webOrigin).origin,
    allowRemote,
  };
}

const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]", ""]);

export function isLoopbackHost(hostname: string) {
  return loopbackHosts.has(hostname);
}

export function assertLocalTargets(targets: {
  baseUrl: string;
  databaseUrl: string;
  allowRemote: boolean;
}) {
  if (targets.allowRemote) return;

  const refuse = (what: string) =>
    new Error(`${what} is not a loopback host. Pass --allow-remote to run against it anyway.`);

  if (!isLoopbackHost(new URL(targets.baseUrl).hostname)) throw refuse("--base-url");

  let database: URL;

  try {
    database = new URL(targets.databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid connection URL");
  }

  if (!isLoopbackHost(database.hostname)) throw refuse("DATABASE_URL");
}
