import { describe, expect, it } from "vitest";
import { isValidSlug, reservedSlugs, suggestSlug } from "./slug.js";

function takenFrom(slugs: string[]) {
  const set = new Set(slugs);

  return (slug: string) => set.has(slug);
}

describe("slugs", () => {
  it("validates slugs", () => {
    expect(isValidSlug("marina-lopes")).toBe(true);
    expect(isValidSlug("abc")).toBe(true);
    expect(isValidSlug("a".repeat(40))).toBe(true);
    expect(isValidSlug("Marina")).toBe(false);
    expect(isValidSlug("marina--lopes")).toBe(false);
    expect(isValidSlug("-marina")).toBe(false);
    expect(isValidSlug("marina-")).toBe(false);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("a".repeat(41))).toBe(false);
    expect(isValidSlug("marina_lopes")).toBe(false);
    expect(isValidSlug("admin")).toBe(false);
    expect(isValidSlug("suporte")).toBe(false);
  });

  it("reserves the routing words", () => {
    expect([...reservedSlugs].sort()).toEqual(
      [
        "admin",
        "api",
        "app",
        "entrar",
        "p",
        "public",
        "offboard",
        "www",
        "static",
        "assets",
        "me",
        "login",
        "logout",
        "help",
        "suporte",
      ].sort(),
    );
  });

  it("suggests a slug from the name", async () => {
    expect(await suggestSlug("Marina Lopes", takenFrom([]))).toBe("marina-lopes");
    expect(await suggestSlug("  José Ação!! ", takenFrom([]))).toBe("jose-acao");
    expect(await suggestSlug("José Ação", takenFrom([]))).toBe("jose-acao");
  });

  it("appends a counter to taken or reserved slugs", async () => {
    expect(await suggestSlug("Marina Lopes", takenFrom(["marina-lopes"]))).toBe("marina-lopes-2");
    expect(
      await suggestSlug("Marina Lopes", async (slug) =>
        ["marina-lopes", "marina-lopes-2"].includes(slug),
      ),
    ).toBe("marina-lopes-3");
    expect(await suggestSlug("Admin", takenFrom([]))).toBe("admin-2");
  });

  it("falls back to curriculo when the name is unusable", async () => {
    expect(await suggestSlug("!!! 😀 ###", takenFrom([]))).toBe("curriculo");
    expect(await suggestSlug("Jô", takenFrom([]))).toBe("curriculo");
    expect(await suggestSlug("", takenFrom(["curriculo"]))).toBe("curriculo-2");
  });

  it("falls back to a random suffix after 100 taken attempts", async () => {
    let calls = 0;

    const alwaysTaken = () => {
      calls += 1;

      return true;
    };

    const short = await suggestSlug("Marina Lopes", alwaysTaken);

    expect(calls).toBe(100);
    expect(short).toMatch(/^marina-lopes-[0-9a-f]{6}$/);

    const long = await suggestSlug("b".repeat(60), alwaysTaken);

    expect(long).toMatch(new RegExp(`^${"b".repeat(33)}-[0-9a-f]{6}$`));
    expect(isValidSlug(long)).toBe(true);
    expect(await suggestSlug("Admin", alwaysTaken)).toMatch(/^admin-[0-9a-f]{6}$/);
    expect(calls).toBe(299);
  });

  it("keeps long suggestions within 40 characters", async () => {
    const name = `${"a".repeat(37)} bcdef`;

    expect(await suggestSlug(name, takenFrom([]))).toBe(`${"a".repeat(37)}-bc`);
    expect(await suggestSlug(name, takenFrom([`${"a".repeat(37)}-bc`]))).toBe(
      `${"a".repeat(37)}-2`,
    );
    expect(await suggestSlug("b".repeat(60), takenFrom(["b".repeat(40)]))).toBe(
      `${"b".repeat(38)}-2`,
    );
    expect(await suggestSlug(`${"c".repeat(39)} d`, takenFrom([]))).toBe("c".repeat(39));
  });
});
