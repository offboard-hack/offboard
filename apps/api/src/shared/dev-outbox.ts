import { appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const signInCodeSubject = "Seu código de acesso ao Offboard";

const message = z.object({ to: z.string(), subject: z.string(), text: z.string() });

export type OutboxMessage = z.infer<typeof message>;

export const defaultOutbox = join(tmpdir(), "offboard-dev-outbox.jsonl");

export function outboxPath(env: Record<string, string | undefined>) {
  return env.DEV_EMAIL_OUTBOX || defaultOutbox;
}

export function appendToOutbox(path: string, entry: OutboxMessage) {
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

export function readOutbox(path: string) {
  let content: string;

  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }

  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = message.safeParse(JSON.parse(line));

        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
}

export function latestCode(messages: OutboxMessage[], email: string) {
  const target = email.toLowerCase();

  const found = messages
    .filter((entry) => entry.to.toLowerCase() === target && entry.subject === signInCodeSubject)
    .at(-1);

  return found?.text.match(/\b\d{6}\b/)?.[0];
}
