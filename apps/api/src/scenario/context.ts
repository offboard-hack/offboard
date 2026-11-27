import { z } from "zod";
import type { Http, Reply } from "./http.js";
import type { Receiver } from "./receiver.js";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type Login = { who: string; email: string; where: string };

export type Context = {
  http: Http;
  env: Record<string, string | undefined>;
  webOrigin: string;
  readCode(email: string): Promise<string>;
  seedCatalog(): Promise<void>;
  startReceiver(): Promise<Receiver>;
  newId(): string;
  today(): string;
  log(line: string): void;
  sessions: Map<string, Session>;
  logins: Login[];
};

export type Session = { cookie: string; grant?: string };

export function expectStatus(reply: Reply, label: string, ...allowed: number[]) {
  if (!allowed.includes(reply.status)) {
    throw new Error(`${label} failed with ${reply.status}: ${JSON.stringify(reply.body)}`);
  }

  return reply;
}

export function parseBody<Schema extends z.ZodType>(reply: Reply, label: string, schema: Schema) {
  const parsed = schema.safeParse(reply.body);

  if (!parsed.success) throw new Error(`${label} returned an unexpected body`);

  return parsed.data;
}

export function addDays(date: string, days: number) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);

  return next.toISOString().slice(0, 10);
}

export function recordLogin(ctx: Context, login: Login) {
  if (!ctx.logins.some((entry) => entry.email === login.email && entry.where === login.where)) {
    ctx.logins.push(login);
  }
}

export function renderLogins(logins: Login[]) {
  return logins.map((login) => `  ${login.who}: ${login.email} -> ${login.where}`);
}
