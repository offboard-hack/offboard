import { createClient } from "@offboard/db/client";
import { createRepositories } from "@offboard/db/repositories";
import { z } from "zod";
import { createApp } from "./app.js";
import { createRuntimeAuth } from "./auth.js";

const db = createClient(z.string().min(1).parse(process.env.POSTGRES_URL));
const { auth, origin } = createRuntimeAuth(db, process.env.WEB_ORIGIN);

const app = createApp(origin, createRepositories(db), {
  auth,
  cronSecret: process.env.CRON_SECRET,
  webhookSecret: process.env.WEBHOOK_SECRET,
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
});

const handle = (request: Request) => app.handle(request);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
