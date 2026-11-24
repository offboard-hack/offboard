import { describe, expect, it } from "vitest";
import { clipText, sanitizeText, storableClip, storableText } from "./storable-text.js";

describe("storable text", () => {
  it("removes NUL and replaces lone surrogates", () => {
    expect(sanitizeText("a\u0000b\ud800x\udc00😀")).toBe("ab�x�😀");
  });

  it("clips without splitting a surrogate pair", () => {
    expect(clipText("ab😀", 3)).toBe("ab");
    expect(clipText("ab😀", 4)).toBe("ab😀");
  });

  it("trims and clips to the limit, 2 000 for stored text", () => {
    expect(storableText("  x\u0000y  ")).toBe("xy");
    expect(storableText("a".repeat(2_001))).toHaveLength(2_000);
    expect(["abc d", " ab😀"].map(storableText)).toEqual(["abc d", "ab😀"]);
    expect(storableClip("abc d", 4)).toBe("abc");
  });
});
