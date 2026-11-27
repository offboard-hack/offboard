import { expect, it } from "vitest";
import { createHttp } from "./http.js";

it("sends JSON with the web origin and cookie and parses JSON replies", async () => {
  const seen: Request[] = [];

  const call = createHttp(
    async (request) => {
      seen.push(request);

      return Response.json({ ok: true }, { headers: { "set-cookie": "a=1; Path=/" } });
    },
    "http://api.example.com",
    "http://web.example.com",
  );

  const reply = await call("POST", "/team", { body: { name: "A" }, cookie: "a=1" });

  expect(reply).toEqual({ status: 200, body: { ok: true }, cookies: ["a=1; Path=/"] });
  expect(seen[0].url).toBe("http://api.example.com/api/team");
  expect(seen[0].headers.get("origin")).toBe("http://web.example.com");
  expect(seen[0].headers.get("cookie")).toBe("a=1");
  expect(await seen[0].json()).toEqual({ name: "A" });
});

it("sends raw bodies and returns text and empty replies", async () => {
  const seen: string[] = [];
  let reply = new Response("plain text", { status: 500 });

  const call = createHttp(
    async (request) => {
      seen.push(await request.text());

      return reply;
    },
    "http://api.example.com",
    "http://web.example.com",
  );

  expect(await call("POST", "/x", { rawBody: "raw" })).toEqual({
    status: 500,
    body: "plain text",
    cookies: [],
  });

  reply = new Response(null, { status: 204 });

  expect(await call("GET", "/y")).toEqual({ status: 204, body: null, cookies: [] });
  expect(seen).toEqual(["raw", ""]);
});
