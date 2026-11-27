import { describe, expect, it } from "vitest";
import { accessVerifier, accessVerifierFromEnv, denyAll } from "./cloudflare-access.js";
import { accessKeys, audience, issuer } from "./access-token.test-utils.js";

describe("accessVerifier", () => {
  it("returns the email of a valid Access token", async () => {
    const { keys, sign } = await accessKeys();
    const verify = accessVerifier(issuer, audience, keys);

    expect(await verify(await sign({ email: "staff@offboard.xyz" }))).toBe("staff@offboard.xyz");
  });

  it("rejects a token issued for another application", async () => {
    const { keys, sign } = await accessKeys();
    const verify = accessVerifier(issuer, audience, keys);

    await expect(
      verify(await sign({ email: "staff@offboard.xyz", aud: "other" })),
    ).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const { keys, sign } = await accessKeys();
    const verify = accessVerifier(issuer, audience, keys);

    await expect(
      verify(await sign({ email: "staff@offboard.xyz", exp: Math.floor(Date.now() / 1000) - 60 })),
    ).rejects.toThrow();
  });

  it("returns nothing when the token has no email claim", async () => {
    const { keys, sign } = await accessKeys();
    const verify = accessVerifier(issuer, audience, keys);

    expect(await verify(await sign({}))).toBeUndefined();
  });
});

describe("accessVerifierFromEnv", () => {
  it("denies everything when the team domain or audience is not configured", async () => {
    expect(await accessVerifierFromEnv({ CF_ACCESS_TEAM_DOMAIN: "team.example" })("token")).toBe(
      undefined,
    );
    expect(await denyAll("token")).toBeUndefined();
  });

  it("builds a verifier when both values are configured", () => {
    const verify = accessVerifierFromEnv({
      CF_ACCESS_TEAM_DOMAIN: "offboard-test.cloudflareaccess.com",
      CF_ACCESS_AUD: audience,
    });

    expect(verify).toBeInstanceOf(Function);
  });
});
