import type { ConfigValue } from "@offboard/db/schema";
import type { ActionConfigsRepository } from "./repository.js";

import type { ActionContext } from "../../shared/action-dispatch.js";
import {
  sendEmail,
  sendSlackBot,
  sendSlackWebhook,
  sendWebhook,
} from "../../shared/notifications.js";

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

function executeWebhook(url: string, method: string, context: ActionContext) {
  return sendWebhook(url, method, context);
}

function executeSlack(webhookUrl: string, message: string, context: ActionContext) {
  return sendSlackWebhook(webhookUrl, templateMessage(message, context));
}

function executeEmail(to: string, subject: string, body: string, context: ActionContext) {
  return sendEmail(to, templateMessage(subject, context), templateMessage(body, context));
}

function executeSlackBot(token: string, channel: string, message: string, context: ActionContext) {
  return sendSlackBot(token, channel, templateMessage(message, context));
}

export async function fireActions(
  repos: Pick<ActionConfigsRepository, "getActionConfigsByPhase">,
  context: ActionContext,
) {
  if (!context.phase) return [] satisfies ActionResult[];

  const configs = await repos.getActionConfigsByPhase(context.phase);
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
        const botToken = str(config.config.botToken) ?? process.env.SLACK_BOT_TOKEN;

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

          await executeSlackBot(botToken, channel, message, context);
          results.push({ actionId: config.actionId, success: true });
        } else {
          results.push({
            actionId: config.actionId,
            success: false,
            error: "missing webhookUrl or botToken",
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
