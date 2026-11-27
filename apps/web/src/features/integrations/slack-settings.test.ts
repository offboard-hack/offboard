import { describe, expect, it } from "vitest";
import { slackErrorMessage, slackTokenSchema } from "./slack-settings";

describe("slackTokenSchema", () => {
  it("accepts a bot token and trims it", () => {
    expect(slackTokenSchema.parse("  xoxb-123-abc  ")).toBe("xoxb-123-abc");
  });

  it("rejects a user token", () => {
    expect(slackTokenSchema.safeParse("xoxp-123").success).toBe(false);
  });
});

describe("slackErrorMessage", () => {
  it("explains a token Slack rejects", () => {
    expect(slackErrorMessage("invalid_auth")).toContain("não aceitou");
  });

  it("explains a revoked token", () => {
    expect(slackErrorMessage("token_revoked")).toContain("revogado");
  });

  it("falls back for unknown errors", () => {
    expect(slackErrorMessage("ratelimited")).toContain("Tente novamente");
    expect(slackErrorMessage(undefined)).toContain("Tente novamente");
  });
});
