import { handle } from "@hono/vercel";
import { createClient, createRepositories } from "@offboard/db";
import { createApp } from "./app.ts";

const app = createApp(createRepositories(createClient(process.env.DATABASE_URL!)));

export default handle(app);
