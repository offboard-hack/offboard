import { createClient } from "@offboard/db/client";
import { createRepositories } from "@offboard/db/repositories";
import { createApp } from "./app.js";

const repos = createRepositories(createClient(process.env.POSTGRES_URL ?? ""));
const app = createApp(process.env.WEB_ORIGIN ?? "*", repos);

async function handle(request: Request) {
  return app.handle(request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
