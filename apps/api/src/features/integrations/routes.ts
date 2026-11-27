import { Elysia, t } from "elysia";
import type { ConfigValue } from "@offboard/db/schema";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { errorResponse } from "../../shared/http.js";
import { matchesSecret } from "../../shared/machine-auth.js";
import type { SecretBox } from "../../shared/secret-box.js";
import { verifySlackToken } from "../../shared/slack.js";
import type { IntegrationsRepository } from "./repository.js";

export const slackIntegration = "Slack";
export const correiosIntegration = "Transportadora::Correios";
export const emailIntegration = "E-mail";

const connectionStatus = t.Union([
  t.Literal("connected"),
  t.Literal("disconnected"),
  t.Literal("reconnect"),
]);

const integrationRow = t.Object({ name: t.String(), status: connectionStatus });

const storedSlack = z.object({
  botToken: z.string(),
  tokenHint: z.string(),
  team: z.string().nullable(),
});

export function slackTokenReader(
  repos: Pick<IntegrationsRepository, "readConfig">,
  box: SecretBox | undefined,
) {
  return async (orgId: string) => {
    const stored = storedSlack.safeParse(await repos.readConfig(orgId, slackIntegration));

    return stored.success && box ? box.open(stored.data.botToken) : undefined;
  };
}

const slackSettings = t.Object({
  configured: t.Boolean(),
  team: t.Nullable(t.String()),
  tokenHint: t.Nullable(t.String()),
});

function slackView(config: Record<string, ConfigValue>) {
  const stored = storedSlack.safeParse(config);

  if (!stored.success) return { configured: false, team: null, tokenHint: null };

  return { configured: true, team: stored.data.team, tokenHint: stored.data.tokenHint };
}

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
  box: SecretBox | undefined,
  slackApiUrl: string,
) {
  return new Elysia()
    .use(access)
    .get("/integrations", ({ principal }) => repos.listIntegrations(principal.orgId), {
      permit: ["read", "Integrations"],
      response: t.Array(integrationRow),
    })
    .put(
      "/integrations/:name",
      async ({ params, body, principal, status }) => {
        if (params.name === slackIntegration) {
          return status(409, { error: "Configure Slack with its bot token" });
        }

        return repos.upsertIntegration(principal.orgId, params.name, body.status);
      },
      {
        permit: ["manage", "Integrations"],
        params: t.Object({ name: t.String() }),
        body: t.Object({ status: connectionStatus }),
        response: { 200: integrationRow, 409: errorResponse },
      },
    )
    .get(
      "/integrations/slack",
      async ({ principal }) => slackView(await repos.readConfig(principal.orgId, slackIntegration)),
      { permit: ["read", "Integrations"], response: slackSettings },
    )
    .put(
      "/integrations/slack",
      async ({ body, principal, status }) => {
        if (!box) return status(503, { error: "Integration secrets are not configured" });

        const verified = await verifySlackToken(slackApiUrl, body.botToken);

        if (!verified.ok) return status(422, { error: verified.error });

        const config = {
          botToken: await box.seal(body.botToken),
          tokenHint: body.botToken.slice(-4),
          team: verified.team ?? null,
        };

        await repos.saveConfig(principal.orgId, slackIntegration, "connected", config);

        return slackView(config);
      },
      {
        permit: ["manage", "Integrations"],
        body: t.Object({ botToken: t.String({ pattern: "^xoxb-[A-Za-z0-9-]+$", maxLength: 255 }) }),
        response: { 200: slackSettings, 422: errorResponse, 503: errorResponse },
      },
    )
    .delete(
      "/integrations/slack",
      async ({ principal }) => {
        await repos.saveConfig(principal.orgId, slackIntegration, "disconnected", {});

        return slackView({});
      },
      { permit: ["manage", "Integrations"], response: slackSettings },
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
