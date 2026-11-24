import { WebClient } from "@slack/web-api";
import { Resend } from "resend";
import type { ActionContext } from "./action-dispatch.js";
import type { RuleContext } from "./rule-dispatch.js";

export async function sendWebhook(
  url: string,
  method: string,
  payload: ActionContext | RuleContext,
) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  return { ok: response.ok, status: response.status };
}

export async function sendSlackWebhook(webhookUrl: string, text: string) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10_000),
  });

  return { ok: response.ok, status: response.status };
}

export async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from: "Offboard <onboarding@resend.dev>",
    to,
    subject,
    html,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function sendSlackBot(token: string, channel: string, text: string) {
  const client = new WebClient(token, {
    retryConfig: { retries: 0 },
    timeout: 10_000,
    slackApiUrl: process.env.SLACK_API_URL,
  });

  await client.chat.postMessage({ channel, text });
}
