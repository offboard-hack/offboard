import { z } from "zod";

const slackResponse = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  team: z.string().optional(),
});

export const defaultSlackApiUrl = "https://slack.com/api/";

type SlackResult = { ok: true; team?: string } | { ok: false; error: string };

async function callSlack(
  apiUrl: string,
  method: string,
  token: string,
  params: Record<string, string>,
) {
  const response = await fetch(new URL(method, apiUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10_000),
  });

  const parsed = slackResponse.safeParse(await response.json().catch(() => null));

  if (!parsed.success) {
    return { ok: false, error: `HTTP ${response.status}` } satisfies SlackResult;
  }

  if (!parsed.data.ok) {
    return { ok: false, error: parsed.data.error ?? "unknown_error" } satisfies SlackResult;
  }

  return { ok: true, team: parsed.data.team } satisfies SlackResult;
}

export function verifySlackToken(apiUrl: string, token: string) {
  return callSlack(apiUrl, "auth.test", token, {});
}

export function postSlackMessage(apiUrl: string, token: string, channel: string, text: string) {
  return callSlack(apiUrl, "chat.postMessage", token, { channel, text });
}
