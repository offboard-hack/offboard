import type { ConfigValue } from "@offboard/db/schema";
import { Resend } from "resend";
import { postSlackMessage } from "../../shared/slack.js";
import type { ActionConfigsRepository } from "./repository.js";

import type { ActionContext } from "../../shared/action-dispatch.js";

export type ActionResult = {
  actionId: string;
  success: boolean;
  error?: string;
};

function str(v: ConfigValue | undefined) {
  return v != null ? String(v) : undefined;
}

function templateMessage(message: string, context: ActionContext) {
  return message
    .replaceAll("{{task}}", context.taskTitle)
    .replaceAll("{{status}}", context.status)
    .replaceAll("{{phase}}", context.phase);
}

async function executeWebhook(url: string, method: string, context: ActionContext) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...context, orgId: undefined }),
    signal: AbortSignal.timeout(10_000),
  });

  return { ok: response.ok, status: response.status };
}

async function executeSlack(webhookUrl: string, message: string, context: ActionContext) {
  const text = templateMessage(message, context);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10_000),
  });

  return { ok: response.ok, status: response.status };
}

async function executeEmail(to: string, subject: string, body: string, context: ActionContext) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const replaceVars = (text: string) =>
    text
      .replaceAll("{{task}}", context.taskTitle)
      .replaceAll("{{status}}", context.status)
      .replaceAll("{{phase}}", context.phase);

  const finalSubject = replaceVars(subject);
  const finalBody = replaceVars(body);

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: "Offboard <onboarding@resend.dev>",
    to,
    subject: finalSubject,
    html: finalBody,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export type SlackDelivery = {
  apiUrl: string;
  readToken: (orgId: string) => Promise<string | undefined>;
};

export async function fireActions(
  repos: Pick<ActionConfigsRepository, "getActionConfigsByPhase">,
  context: ActionContext,
  slack: SlackDelivery,
) {
  if (!context.phase) return [] satisfies ActionResult[];

  const configs = await repos.getActionConfigsByPhase(context.orgId, context.phase);
  const results: ActionResult[] = [];

  for (const config of configs) {
    try {
      if (config.actionId.startsWith("webhook:")) {
        const url = str(config.config.url);
        const method = str(config.config.method) ?? "POST";

        if (!url) {
          results.push({ actionId: config.actionId, success: false, error: "missing url" });
          continue;
        }

        const { ok, status } = await executeWebhook(url, method, context);

        results.push({
          actionId: config.actionId,
          success: ok,
          error: ok ? undefined : `HTTP ${status}`,
        });
      } else if (config.actionId.startsWith("slack:")) {
        const webhookUrl = str(config.config.webhookUrl);
        const message = str(config.config.message) ?? "Task {{task}} changed to {{status}}";
        const botToken = str(config.config.botToken) ?? (await slack.readToken(context.orgId));

        if (webhookUrl) {
          const { ok, status } = await executeSlack(webhookUrl, message, context);

          results.push({
            actionId: config.actionId,
            success: ok,
            error: ok ? undefined : `HTTP ${status}`,
          });
        } else if (botToken) {
          const channel = str(config.config.channel);

          if (!channel) {
            results.push({
              actionId: config.actionId,
              success: false,
              error: "missing channel",
            });
            continue;
          }

          const sent = await postSlackMessage(
            slack.apiUrl,
            botToken,
            channel,
            templateMessage(message, context),
          );

          results.push({
            actionId: config.actionId,
            success: sent.ok,
            error: sent.ok ? undefined : sent.error,
          });
        } else {
          results.push({
            actionId: config.actionId,
            success: false,
            error: "Slack not configured",
          });
        }
      } else if (config.actionId.startsWith("email:")) {
        const to = str(config.config.to);

        if (!to) {
          results.push({ actionId: config.actionId, success: false, error: "missing to" });
          continue;
        }

        const subject = str(config.config.subject) ?? "Offboard: {{task}} — {{status}}";

        const body =
          str(config.config.body) ??
          "<p>Task <b>{{task}}</b> changed to <b>{{status}}</b> in phase <b>{{phase}}</b>.</p>";

        const result = await executeEmail(to, subject, body, context);

        results.push({
          actionId: config.actionId,
          success: result.ok,
          error: result.ok ? undefined : result.error,
        });
      } else {
        results.push({ actionId: config.actionId, success: false, error: "unknown action type" });
      }
    } catch (error) {
      results.push({ actionId: config.actionId, success: false, error: String(error) });
    }
  }

  return results;
}
