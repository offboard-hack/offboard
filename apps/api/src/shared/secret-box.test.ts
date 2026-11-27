import { describe, expect, it } from "vitest";
import { secretBox } from "./secret-box.ts";

describe("secretBox", () => {
  const box = secretBox("integration-secret-key-for-tests-0001");

  it("round-trips a value without storing it in clear text", async () => {
    const sealed = await box.seal("xoxb-secret");

    expect(sealed).not.toContain("xoxb-secret");
    expect(await box.open(sealed)).toBe("xoxb-secret");
  });

  it("uses a fresh nonce for every seal", async () => {
    expect(await box.seal("same")).not.toBe(await box.seal("same"));
  });

  it("refuses a value sealed under another key", async () => {
    const sealed = await secretBox("another-secret-key-for-tests-000002").seal("xoxb-secret");

    expect(await box.open(sealed)).toBeUndefined();
  });

  it("refuses a malformed value", async () => {
    expect(await box.open("not-sealed")).toBeUndefined();
  });
});
