import { z } from "zod";

export const scenarioNames = [
  "orgs",
  "add-person",
  "company-payment",
  "career",
  "offboarding",
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

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

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
    throw new Error(`Usage: npm run scenario -- <${scenarioNames.join("|")}> [--base-url URL]`);
  }

  const parsed = options.parse({
    baseUrl: values.get("base-url"),
    webOrigin: values.get("web-origin"),
  });

  return {
    name: name.data,
    baseUrl: new URL(parsed.baseUrl).origin,
    webOrigin: new URL(parsed.webOrigin).origin,
  };
}
