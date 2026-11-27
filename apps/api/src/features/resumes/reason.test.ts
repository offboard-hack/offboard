import { describe, expect, it } from "vitest";
import { plainReason } from "./reason.js";

describe("plainReason", () => {
  it("keeps plain explanations untouched", () => {
    expect(plainReason("Bons verbos de ação; falta mostrar resultados.")).toBe(
      "Bons verbos de ação; falta mostrar resultados.",
    );
    expect(plainReason("Aumentou a receita em 3,5% e reduziu custos.")).toBe(
      "Aumentou a receita em 3,5% e reduziu custos.",
    );
    expect(plainReason("")).toBe("");
  });

  it("drops the clause that carries the arithmetic", () => {
    expect(plainReason("Poucos números, 20 × 1/6 ≈ 3 pontos, mas há verbos fortes.")).toBe(
      "Poucos números, mas há verbos fortes.",
    );
    expect(plainReason("Faltam métricas nos bullets. 20 × 1/6 ≈ 3.")).toBe(
      "Faltam métricas nos bullets.",
    );
    expect(plainReason("Um número em seis bullets: 1/6 do máximo. Inclua mais resultados.")).toBe(
      "Inclua mais resultados.",
    );
    expect(plainReason("Resumo curto; 5 = 10 - 5; vale detalhar o foco.")).toBe(
      "Resumo curto; vale detalhar o foco.",
    );
  });

  it("removes parenthetical arithmetic and keeps other parentheses", () => {
    expect(plainReason("Poucos resultados (20 × 1/6 ≈ 3) no currículo.")).toBe(
      "Poucos resultados no currículo.",
    );
    expect(plainReason("Bom uso de ferramentas (SQL, Python) no currículo.")).toBe(
      "Bom uso de ferramentas (SQL, Python) no currículo.",
    );
  });

  it("catches fractions with spaces and trailing separators", () => {
    expect(plainReason("Bom resumo, 2 / 3 dos itens, e boa estrutura")).toBe(
      "Bom resumo, e boa estrutura",
    );
    expect(plainReason("Boa estrutura, 4/5")).toBe("Boa estrutura.");
  });

  it("capitalizes what is left when the opening clause goes", () => {
    expect(plainReason("20 × 1/6 ≈ 3; ainda assim há bons verbos.")).toBe(
      "Ainda assim há bons verbos.",
    );
  });

  it("returns an empty reason when nothing plain is left", () => {
    expect(plainReason("20 × 1/6 ≈ 3")).toBe("");
  });
});
