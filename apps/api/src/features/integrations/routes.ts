import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { errorResponse } from "../../shared/http.js";
import { matchesSecret } from "../../shared/machine-auth.js";
import type { IntegrationsRepository } from "./repository.js";

const connectionStatus = t.Union([
  t.Literal("connected"),
  t.Literal("disconnected"),
  t.Literal("reconnect"),
]);

const integrationRow = t.Object({ name: t.String(), status: connectionStatus });

const slackEvent = z.object({
  type: z.string(),
  challenge: z.string().optional(),
});

function hasSlackSignature(request: Request, body: string, secret: string | undefined) {
  const timestamp = request.headers.get("x-slack-request-timestamp");

  if (!secret || !timestamp || !/^\d+$/.test(timestamp)) return false;

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");

  return matchesSecret(request.headers.get("x-slack-signature"), `v0=${digest}`);
}

export function integrationsRoutes(
  repos: IntegrationsRepository,
  access: PortalAccessPlugin,
  slackSigningSecret: string | undefined,
) {
  return new Elysia()
    .use(access)
    .get("/integrations", () => repos.listIntegrations(), {
      permit: ["read", "Integrations"],
      response: t.Array(integrationRow),
    })
    .put(
      "/integrations/:name",
      async ({ params, body }) => repos.upsertIntegration(params.name, body.status),
      {
        permit: ["manage", "Integrations"],
        params: t.Object({ name: t.String() }),
        body: t.Object({ status: connectionStatus }),
        response: integrationRow,
      },
    )
    .post(
      "/integrations/slack/events",
      async ({ request, status }) => {
        const body = await request.text();

        if (!hasSlackSignature(request, body, slackSigningSecret)) {
          return status(401, { error: "Unauthorized" });
        }

        const parsed = z
          .string()
          .transform((text, context) => {
            try {
              return JSON.parse(text);
            } catch {
              context.addIssue({ code: "custom", message: "Invalid JSON" });

              return z.NEVER;
            }
          })
          .pipe(slackEvent)
          .safeParse(body);

        if (!parsed.success) return status(422, { error: "Invalid Slack event" });

        if (parsed.data.type === "url_verification" && parsed.data.challenge) {
          return { challenge: parsed.data.challenge };
        }

        return { ok: true } satisfies { ok: true };
      },
      {
        parse: "none",
        response: {
          200: t.Union([t.Object({ challenge: t.String() }), t.Object({ ok: t.Literal(true) })]),
          401: errorResponse,
          422: errorResponse,
        },
      },
    );
}
