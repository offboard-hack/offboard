import { describe, expect, it } from "vitest";
import { rejectionLabel, rejectionNote, rejectionReasons } from "./rejections";

describe("labels rejection reasons", () => {
  it("names every reason the API accepts", () => {
    expect(rejectionReasons.map(({ value }) => rejectionLabel(value))).toEqual([
      "Não tenho interesse",
      "Salário",
      "Local",
      "Modelo de trabalho",
      "Senioridade",
      "Empresa",
      "Outro motivo",
    ]);
  });
});

describe("reads the optional note", () => {
  it("trims it, drops an empty one and limits its length", () => {
    expect(rejectionNote("  longe demais ")).toEqual({ note: "longe demais" });
    expect(rejectionNote("   ")).toEqual({ note: null });
    expect(rejectionNote("x".repeat(501))).toEqual({ problem: "Use até 500 caracteres." });
  });
});
