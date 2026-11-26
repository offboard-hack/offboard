import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { createEmailSender, type CloudflareEmailBinding } from "./email.js";
import { signInCodeEmail, signInEmail } from "./sign-in-email.js";

it("requires a native EMAIL binding when Cloudflare is selected", () => {
  expect(() => createEmailSender({ EMAIL_PROVIDER: "cloudflare" })).toThrow(
    "Cloudflare Email requires the EMAIL Worker binding",
  );
});

it("sends email through the native Cloudflare binding", async () => {
  const runtime = new Miniflare({
    workers: [
      {
        config: {
          name: "auth-email-test",
          compatibilityDate: "2026-11-23",
          env: { EMAIL: { type: "send-email" } },
          manifest: {
            mainModule: "worker.mjs",
            modules: {
              "worker.mjs": {
                type: "esm",
                contents: "export default { fetch() { return new Response() } }",
              },
            },
          },
        },
      },
    ],
  });

  try {
    const { EMAIL } = await runtime.getBindings<{ EMAIL: CloudflareEmailBinding }>();

    const sender = createEmailSender(
      { EMAIL_PROVIDER: "cloudflare", AUTH_EMAIL_FROM: "auth@offboard.example" },
      EMAIL,
    );

    await expect(
      sender.send(
        signInEmail({
          email: "test@offboard.example",
          url: "https://offboard.example/api/auth/magic-link/verify",
        }),
      ),
    ).resolves.toBeUndefined();
  } finally {
    await runtime.dispose();
  }
});

it("renders the sign-in code inside the branded template", () => {
  const message = signInCodeEmail({
    email: "pessoa@offboard.example",
    code: "482913",
    minutes: 10,
    origin: "https://offboard.example",
  });

  expect(message).toMatchObject({
    to: "pessoa@offboard.example",
    subject: "Seu código de acesso ao Offboard",
  });
  expect(message.text).toContain("482913");
  expect(message.text).toContain("O código expira em 10 minutos");
  expect(message.html).toContain(">482913</span>");
  expect(message.html).toContain('src="https://offboard.example/apple-touch-icon.png"');
  expect(message.html).toContain("Seu código para entrar");
});
