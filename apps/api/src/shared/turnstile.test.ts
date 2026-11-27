import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { turnstile } from "./turnstile.js";

const replies: { status: number; body: string }[] = [];
const received: string[] = [];

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) chunks.push(Buffer.from(chunk));

  return Buffer.concat(chunks).toString();
}

const server = createServer(async (request, response) => {
  received.push(await readBody(request));

  const reply = replies.shift() ?? { status: 200, body: '{"success":true}' };

  response.writeHead(reply.status, { "content-type": "application/json" });
  response.end(reply.body);
});

let endpoint = "";

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  // WARNING: listen(0) guarantees AddressInfo with a port
  const address = server.address() as AddressInfo;

  endpoint = `http://127.0.0.1:${address.port}/siteverify`;
});

afterAll(() => {
  server.close();
});

describe("turnstile", () => {
  it("sends the secret, token and visitor ip and trusts only a successful verdict", async () => {
    const captcha = turnstile("site-key", "secret-key", endpoint);

    expect(captcha.siteKey).toBe("site-key");
    expect(await captcha.verify("token-1", "203.0.113.7")).toBe(true);
    expect(received.at(-1)).toContain("secret-key");
    expect(received.at(-1)).toContain("token-1");
    expect(received.at(-1)).toContain("203.0.113.7");

    expect(await captcha.verify("token-2", null)).toBe(true);
    expect(received.at(-1)).not.toContain("remoteip");

    replies.push({ status: 200, body: '{"success":false}' });
    expect(await captcha.verify("token-3", null)).toBe(false);

    replies.push({ status: 500, body: '{"success":true}' });
    expect(await captcha.verify("token-4", null)).toBe(false);

    replies.push({ status: 200, body: '{"ok":true}' });
    expect(await captcha.verify("token-5", null)).toBe(false);
  });
});
