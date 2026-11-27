import { z } from "zod";

const verdict = z.object({ success: z.boolean() });

export type Captcha = {
  siteKey: string;
  verify: (token: string, ip: string | null) => Promise<boolean>;
};

export function turnstile(
  siteKey: string,
  secret: string,
  endpoint = "https://challenges.cloudflare.com/turnstile/v0/siteverify",
) {
  const verify = async (token: string, ip: string | null) => {
    const body = new FormData();

    body.set("secret", secret);
    body.set("response", token);

    if (ip) body.set("remoteip", ip);

    const res = await fetch(endpoint, { method: "POST", body });

    if (!res.ok) return false;

    const parsed = verdict.safeParse(await res.json());

    return parsed.success && parsed.data.success;
  };

  const captcha: Captcha = { siteKey, verify };

  return captcha;
}
