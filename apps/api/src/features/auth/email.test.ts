import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmailSender, emailProvider, type CloudflareEmailBinding } from "./email.js";
import { employeeInviteEmail, signInCodeEmail, signInEmail } from "./sign-in-email.js";

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

it("escapes the names HR typed into the employee invite", () => {
  const message = employeeInviteEmail({
    email: "pessoa@offboard.example",
    name: "  <b>Ana</b> Souza",
    company: 'Acme "S&A"',
    origin: "https://offboard.example",
  });

  expect(message).toMatchObject({
    to: "pessoa@offboard.example",
    subject: "Seu acesso ao Offboard",
  });
  expect(message.text).toContain("Olá, <b>Ana</b>.");
  expect(message.html).toContain("Olá, &lt;b&gt;Ana&lt;/b&gt;.");
  expect(message.html).toContain("Acme &quot;S&amp;A&quot; cadastrou este endereço");
  expect(message.html).not.toContain("<b>Ana");
  expect(message.html).toContain('href="https://offboard.example/colaborador/entrar"');
});

it("writes console mail to the dev outbox", async () => {
  const outbox = join(mkdtempSync(join(tmpdir(), "offboard-outbox-")), "mail.jsonl");

  const sender = createEmailSender({
    EMAIL_PROVIDER: "console",
    NODE_ENV: "development",
    DEV_EMAIL_OUTBOX: outbox,
  });

  await sender.send({
    to: "a@example.com",
    subject: "Assunto",
    text: "Corpo 123456",
    html: "<p>x</p>",
  });

  expect(JSON.parse(readFileSync(outbox, "utf8"))).toEqual({
    to: "a@example.com",
    subject: "Assunto",
    text: "Corpo 123456",
  });
  expect(emailProvider.safeParse("console").success).toBe(false);
});

it("allows console mail only in an explicitly local environment", () => {
  const refused = "requires NODE_ENV=development or test";

  expect(() => createEmailSender({ EMAIL_PROVIDER: "console" })).toThrow(refused);
  expect(() => createEmailSender({ EMAIL_PROVIDER: "console", NODE_ENV: "production" })).toThrow(
    refused,
  );
  expect(() => createEmailSender({ EMAIL_PROVIDER: "console", NODE_ENV: "staging" })).toThrow(
    refused,
  );
  expect(() =>
    createEmailSender({ EMAIL_PROVIDER: "console", NODE_ENV: "development", VERCEL: "1" }),
  ).toThrow(refused);
  expect(() =>
    createEmailSender({ EMAIL_PROVIDER: "console", NODE_ENV: "test", VERCEL: "0" }),
  ).toThrow(refused);
  expect(() => createEmailSender({ EMAIL_PROVIDER: "console", NODE_ENV: "test" })).not.toThrow();
});
