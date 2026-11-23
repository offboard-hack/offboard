import { Resend } from "resend";
import { z } from "zod";

type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface CloudflareEmailBinding {
  send(message: EmailMessage & { from: string }): Promise<{ messageId: string }>;
}

export const emailProvider = z.enum(["resend", "cloudflare"]).default("resend");

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

export function createEmailSender(
  env: Record<string, string | undefined>,
  cloudflare?: CloudflareEmailBinding,
) {
  const provider = emailProvider.parse(env.EMAIL_PROVIDER);

  if (provider === "resend") return createResendSender(resendConfig.parse(env));

  if (!cloudflare) throw new Error("Cloudflare Email requires the EMAIL Worker binding");

  return createCloudflareSender(cloudflareConfig.parse(env).AUTH_EMAIL_FROM, cloudflare);
}
