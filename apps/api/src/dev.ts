import { serve } from "@hono/node-server";
import { createClient, createRepositories } from "@offboard/db";
import { createApp } from "./app.ts";

const port = 3001;
const app = createApp(createRepositories(createClient(process.env.DATABASE_URL!)));

serve({ fetch: app.fetch, port });

console.log(`API listening on http://localhost:${port}`);
