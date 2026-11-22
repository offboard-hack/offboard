import type { ConfigValue } from "@offboard/db/schema";
import type { Repositories } from "./app.js";

export type ActionContext = {
  taskId: string;
  taskTitle: string;
  status: string;
  phase: string;
};

export type ActionResult = {
  actionId: string;
  success: boolean;
  error?: string;
};

function str(v: ConfigValue | undefined) {
  return v != null ? String(v) : undefined;
}

async function executeWebhook(url: string, method: string, context: ActionContext) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(context),
    signal: AbortSignal.timeout(10_000),
  });

  return { ok: response.ok, status: response.status };
}

async function executeSlack(webhookUrl: string, message: string, context: ActionContext) {
  const text = message
    .replaceAll("{{task}}", context.taskTitle)
    .replaceAll("{{status}}", context.status)
    .replaceAll("{{phase}}", context.phase);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10_000),
  });

  return { ok: response.ok, status: response.status };
}

export async function fireActions(repos: Repositories, context: ActionContext) {
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

        if (!webhookUrl) {
          results.push({ actionId: config.actionId, success: false, error: "missing webhookUrl" });
          continue;
        }

        const { ok, status } = await executeSlack(webhookUrl, message, context);

        results.push({
          actionId: config.actionId,
          success: ok,
          error: ok ? undefined : `HTTP ${status}`,
        });
      } else if (config.actionId.startsWith("email:")) {
        results.push({ actionId: config.actionId, success: true });
      } else {
        results.push({ actionId: config.actionId, success: false, error: "unknown action type" });
      }
    } catch (error) {
      results.push({ actionId: config.actionId, success: false, error: String(error) });
    }
  }

  return results;
}
