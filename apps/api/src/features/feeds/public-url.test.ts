import { describe, expect, it } from "vitest";
import { parsePublicUrl } from "./public-url.ts";

describe("parsePublicUrl", () => {
  it("accepts a public https url", () => {
    expect(parsePublicUrl("https://jobs.example.com/a")).toEqual(
      new URL("https://jobs.example.com/a"),
    );
  });

  it("accepts the explicit default port", () => {
    expect(parsePublicUrl("https://jobs.example.com:443/a")).toEqual(
      new URL("https://jobs.example.com/a"),
    );
  });

  it.each([
    "http://jobs.example.com/a",
    "https://user:pw@x.com",
    "https://user@x.com",
    "https://x.com:8443",
    "https://localhost",
    "https://localhost./",
    "https://localhost..",
    "https://x.internal..",
    "https://127.0.0.1..",
    "https://127.1..",
    "https://10.1..",
    "https://0x7f.0.0.1..",
    "https://jobs..example.com",
    "https://loc%61lhost",
    "https://app.localhost",
    "https://printer.local",
    "https://db.internal",
    "https://x.internal./",
    "https://intranet",
    "https://10.0.0.1",
    "https://169.254.169.254",
    "https://127.0.0.1",
    "https://0x7f.1",
    "https://2130706433",
    "https://8.8.8.8",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "ftp://jobs.example.com",
    "not a url",
  ])("rejects %s", (raw) => {
    expect(parsePublicUrl(raw)).toBe("invalid_url");
  });
});
