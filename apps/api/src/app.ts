import { cors } from "@elysia/cors";
import { node } from "@elysia/node";
import { Elysia, t } from "elysia";

export function createApp(webOrigin: string) {
  return new Elysia({ adapter: node(), prefix: "/api" })
    .use(cors({ origin: webOrigin, credentials: false }))
    .get("/health", () => ({ status: "ok" }) satisfies { status: "ok" }, {
      response: t.Object({ status: t.Literal("ok") }),
    });
}

export type App = ReturnType<typeof createApp>;
