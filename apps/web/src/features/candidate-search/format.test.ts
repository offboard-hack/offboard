import { describe, expect, it } from "vitest";
import { examples, initials, period, resultSummary, searchFailure } from "./format";

describe("candidate search formatting", () => {
  it("takes up to two initials", () => {
    expect(initials("marina  lopes da silva")).toBe("ML");
    expect(initials("Ana")).toBe("A");
  });

  it("formats experience periods by year", () => {
    expect(period("2021-03", null)).toBe("desde 2021");
    expect(period("2018", "2021-02")).toBe("2018–2021");
    expect(period("", null)).toBe("atual");
    expect(period("", "2020")).toBe("até 2020");
  });

  it("explains failures and results", () => {
    expect(searchFailure(429)).toMatch(/muitas buscas/);
    expect(searchFailure(503)).toMatch(/indisponível/);
    expect(searchFailure(500)).toBe("Não foi possível buscar. Tente de novo.");
    expect(resultSummary(0, "go")).toBe(
      "Ninguém encontrado para “go”. Tente descrever de outro jeito.",
    );
    expect(resultSummary(1, "go")).toBe("1 pessoa para “go”");
    expect(resultSummary(3, "go")).toBe("3 pessoas para “go”");
    expect(examples.length).toBeGreaterThan(0);
  });
});
