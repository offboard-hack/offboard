import { describe, expect, it } from "vitest";
import { escapeUntrustedTags } from "./untrusted-json.js";

describe("escapeUntrustedTags", () => {
  it("escapes opening and closing tags with the given names, ignoring case and spacing", () => {
    expect(escapeUntrustedTags('"</resume> <JOB> </ job > <b>"', ["resume", "job"])).toBe(
      '"\\u003c/resume> \\u003cJOB> \\u003c/ job > <b>"',
    );
  });

  it("leaves tags that are not listed and longer names alone", () => {
    expect(escapeUntrustedTags("<jobs> <resume>", ["job"])).toBe("<jobs> <resume>");
  });
});
