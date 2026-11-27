import { describe, expect, it } from "vitest";
import { equipmentDefaults, equipmentErrorMessage, equipmentFormSchema } from "./equipment-form";

const valid = { caseId: "c1", item: " Notebook ", tag: " AUR-1 ", returnMethod: "pickup" };

describe("equipmentFormSchema", () => {
  it("trims the item and tag", () => {
    expect(equipmentFormSchema.parse(valid)).toEqual({
      caseId: "c1",
      item: "Notebook",
      tag: "AUR-1",
      returnMethod: "pickup",
    });
  });

  it("rejects a tag with spaces", () => {
    const result = equipmentFormSchema.safeParse({ ...valid, tag: "AUR 1" });

    expect(result.error?.issues[0]?.message).toBe("O patrimônio não pode ter espaços.");
  });

  it("requires a case and a return method", () => {
    const result = equipmentFormSchema.safeParse({ ...valid, caseId: "", returnMethod: "" });

    expect(result.error?.issues.map(({ message }) => message)).toEqual([
      "Escolha o desligamento.",
      "Escolha como o bem volta.",
    ]);
  });
});

describe("equipmentDefaults", () => {
  it("starts empty for a new item", () => {
    expect(equipmentDefaults()).toEqual({ caseId: "", item: "", tag: "", returnMethod: "pickup" });
  });

  it("maps an existing item back to the form", () => {
    const item = { caseId: "c1", title: "Monitor", code: "AUR-2", method: "office" as const };

    expect(equipmentDefaults(item)).toEqual({
      caseId: "c1",
      item: "Monitor",
      tag: "AUR-2",
      returnMethod: "in_person",
    });
    expect(equipmentDefaults({ ...item, method: "pickup" }).returnMethod).toBe("pickup");
  });
});

describe("equipmentErrorMessage", () => {
  it("explains a tag in use", () => {
    expect(equipmentErrorMessage("Asset tag already in use")).toContain("já está cadastrado");
  });

  it("falls back for unknown errors", () => {
    expect(equipmentErrorMessage(undefined)).toContain("Tente novamente");
  });
});
