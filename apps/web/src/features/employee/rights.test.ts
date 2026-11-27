import { describe, expect, it } from "vitest";
import { rights, rightsDisclaimer } from "./rights";

describe("rights", () => {
  it("covers the topics the collaborator asks about", () => {
    expect(rights.map(({ id }) => id)).toEqual([
      "seguro-desemprego",
      "fgts",
      "aviso-previo",
      "ferias",
      "decimo-terceiro",
      "prazo-rescisao",
      "exame-demissional",
      "rescisao-trct",
      "plano-de-saude",
    ]);
  });

  it("keeps ids and questions unique", () => {
    expect(new Set(rights.map(({ id }) => id)).size).toBe(rights.length);
    expect(new Set(rights.map(({ question }) => question)).size).toBe(rights.length);
  });

  it("gives every entry an answer", () => {
    for (const { paragraphs, points } of rights) {
      expect(paragraphs.length).toBeGreaterThan(0);
      expect(points?.length ?? 1).toBeGreaterThan(0);
    }
  });

  it("states it is not legal advice", () => {
    expect(rightsDisclaimer).toContain("Não substitui orientação jurídica");
  });
});
