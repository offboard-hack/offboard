import { Resend } from "resend";
import { z } from "zod";
import { appendToOutbox, outboxPath } from "../../shared/dev-outbox.js";

type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface CloudflareEmailBinding {
  send(message: EmailMessage & { from: string }): Promise<{ messageId: string }>;
}

export const emailProvider = z.enum(["resend", "cloudflare"]).default("resend");

const localEmailProvider = z.enum(["resend", "cloudflare", "console"]).default("resend");

const resendConfig = z.object({
  AUTH_EMAIL_FROM: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
});

const cloudflareConfig = z.object({
  AUTH_EMAIL_FROM: z.email(),
});

function createResendSender(config: z.infer<typeof resendConfig>) {
  const resend = new Resend(config.RESEND_API_KEY);

  return {
    async send(message) {
      const { error } = await resend.emails.send({ from: config.AUTH_EMAIL_FROM, ...message });

      if (error) throw new Error("Could not send the Offboard sign-in link");
    },
  } satisfies EmailSender;
}

function createCloudflareSender(from: string, binding: CloudflareEmailBinding) {
  return {
    async send(message) {
      await binding.send({ from, ...message });
    },
  } satisfies EmailSender;
}

function createConsoleSender(env: Record<string, string | undefined>) {
  const local = env.NODE_ENV === "development" || env.NODE_ENV === "test";

  if (!local || env.VERCEL !== undefined) {
    throw new Error(
      "EMAIL_PROVIDER=console requires NODE_ENV=development or test and no VERCEL variable",
    );
  }

  const path = outboxPath(env);

  return {
    async send(message) {
      appendToOutbox(path, { to: message.to, subject: message.subject, text: message.text });
      console.info(`[offboard dev email] to=${message.to} subject=${message.subject}`);
      console.info(message.text);
    },
  } satisfies EmailSender;
}

export function createEmailSender(
  env: Record<string, string | undefined>,
  cloudflare?: CloudflareEmailBinding,
) {
  const provider = localEmailProvider.parse(env.EMAIL_PROVIDER);

  if (provider === "console") return createConsoleSender(env);

  if (provider === "resend") return createResendSender(resendConfig.parse(env));

  if (!cloudflare) throw new Error("Cloudflare Email requires the EMAIL Worker binding");

  return createCloudflareSender(cloudflareConfig.parse(env).AUTH_EMAIL_FROM, cloudflare);
}
