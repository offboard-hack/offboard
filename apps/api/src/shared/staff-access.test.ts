import { Elysia } from "elysia";
import { describe, expect, it } from "vitest";
import { accessVerifier } from "./cloudflare-access.js";
import { accessKeys, audience, issuer } from "./access-token.test-utils.js";
import { backofficeAccessFromEnv, parseStaffEmails, staffAccess } from "./staff-access.js";

async function probe(
  access: Awaited<ReturnType<typeof accessKeys>>,
  token: string | undefined,
  emails: string,
) {
  const verify = accessVerifier(issuer, audience, access.keys);

  return new Elysia()
    .use(staffAccess({ verify, staffEmails: parseStaffEmails(emails) }))
    .get("/probe", () => ({ ok: true }), { staff: true })
    .handle(
      new Request("http://api.test/probe", {
        headers: token === undefined ? {} : { "cf-access-jwt-assertion": token },
      }),
    );
}

describe("parseStaffEmails", () => {
  it("splits, trims and lowercases the allowlist", () => {
    expect(parseStaffEmails(" Ana@x.com, ,BEA@x.com ")).toEqual(
      new Set(["ana@x.com", "bea@x.com"]),
    );
  });

  it("is empty when the variable is unset", () => {
    expect(parseStaffEmails(undefined)).toEqual(new Set());
  });
});

describe("staffAccess", () => {
  it("rejects a request without an Access token", async () => {
    const response = await probe(await accessKeys(), undefined, "staff@offboard.xyz");

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a token that does not verify", async () => {
    const { keys, sign } = await accessKeys();
    const bad = await sign({ email: "staff@offboard.xyz", aud: "other" });
    const verify = accessVerifier(issuer, audience, keys);

    const app = new Elysia()
      .use(staffAccess({ verify, staffEmails: new Set(["staff@offboard.xyz"]) }))
      .get("/probe", () => ({ ok: true }), { staff: true });

    const response = await app.handle(
      new Request("http://api.test/probe", { headers: { "cf-access-jwt-assertion": bad } }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects an authenticated identity that is not on the allowlist", async () => {
    const access = await accessKeys();

    const response = await probe(
      access,
      await access.sign({ email: "ceo@acme.com" }),
      "staff@offboard.xyz",
    );

    expect(response.status).toBe(403);
  });

  it("denies everyone when the allowlist is empty", async () => {
    const access = await accessKeys();
    const response = await probe(access, await access.sign({ email: "staff@offboard.xyz" }), "");

    expect(response.status).toBe(403);
  });

  it("admits an allowlisted identity regardless of email case", async () => {
    const access = await accessKeys();

    const response = await probe(
      access,
      await access.sign({ email: "Staff@Offboard.xyz" }),
      "staff@offboard.xyz",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("backofficeAccessFromEnv", () => {
  it("reads the staff allowlist and keeps the verifier closed without Access config", async () => {
    const access = backofficeAccessFromEnv({ BACKOFFICE_STAFF_EMAILS: "staff@offboard.xyz" });

    expect(access.staffEmails).toEqual(new Set(["staff@offboard.xyz"]));
    expect(await access.verify("token")).toBeUndefined();
  });
});
