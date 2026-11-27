import { describe, expect, it } from "vitest";
import {
  assignFormSchema,
  equipmentDefaults,
  equipmentErrorMessage,
  equipmentFormSchema,
  equipmentPayload,
} from "./equipment-form";

const valid = {
  caseId: "c1",
  email: "",
  item: " Notebook ",
  tag: " AUR-1 ",
  returnMethod: "pickup",
};

describe("equipmentFormSchema", () => {
  it("trims the item and tag", () => {
    expect(equipmentFormSchema.parse(valid)).toEqual({
      caseId: "c1",
      email: "",
      item: "Notebook",
      tag: "AUR-1",
      returnMethod: "pickup",
    });
  });

  it("rejects a tag with spaces", () => {
    const result = equipmentFormSchema.safeParse({ ...valid, tag: "AUR 1" });

    expect(result.error?.issues[0]?.message).toBe("O patrimônio não pode ter espaços.");
  });

  it("accepts stock with no case, and requires a return method", () => {
    expect(equipmentFormSchema.safeParse({ ...valid, caseId: "" }).success).toBe(true);

    const result = equipmentFormSchema.safeParse({ ...valid, returnMethod: "" });

    expect(result.error?.issues.map(({ message }) => message)).toEqual([
      "Escolha como o bem volta.",
    ]);
  });

  it("normalizes the e-mail and rejects an invalid one", () => {
    expect(equipmentFormSchema.parse({ ...valid, email: " Ana@Empresa.com " }).email).toBe(
      "ana@empresa.com",
    );
    expect(
      equipmentFormSchema.safeParse({ ...valid, email: "ana" }).error?.issues[0]?.message,
    ).toBe("Informe um e-mail válido.");
  });
});

describe("assignFormSchema", () => {
  it("requires a valid e-mail", () => {
    expect(assignFormSchema.parse({ email: " Ana@Empresa.com " })).toEqual({
      email: "ana@empresa.com",
    });
    expect(assignFormSchema.safeParse({ email: "" }).success).toBe(false);
  });
});

describe("equipmentPayload", () => {
  const fields = { item: "Notebook", tag: "AUR-1", returnMethod: "pickup" as const };

  it("sends the chosen case and drops the e-mail", () => {
    expect(equipmentPayload({ ...fields, caseId: "c1", email: "ana@empresa.com" })).toEqual({
      ...fields,
      caseId: "c1",
      email: undefined,
    });
  });

  it("sends the e-mail when no case is chosen", () => {
    expect(equipmentPayload({ ...fields, caseId: "", email: "ana@empresa.com" })).toEqual({
      ...fields,
      caseId: undefined,
      email: "ana@empresa.com",
    });
  });

  it("sends neither for plain stock", () => {
    expect(equipmentPayload({ ...fields, caseId: "", email: "" })).toEqual({
      ...fields,
      caseId: undefined,
      email: undefined,
    });
  });
});

describe("equipmentDefaults", () => {
  it("starts empty for a new item", () => {
    expect(equipmentDefaults()).toEqual({
      caseId: "",
      email: "",
      item: "",
      tag: "",
      returnMethod: "pickup",
    });
  });

  it("maps an existing item back to the form", () => {
    const item = { caseId: "c1", title: "Monitor", code: "AUR-2", method: "office" as const };

    expect(equipmentDefaults(item)).toEqual({
      caseId: "c1",
      email: "",
      item: "Monitor",
      tag: "AUR-2",
      returnMethod: "in_person",
    });
    expect(equipmentDefaults({ ...item, method: "pickup" }).returnMethod).toBe("pickup");
  });

  it("maps an item without a case to an empty case", () => {
    const item = { caseId: null, title: "Monitor", code: "AUR-2", method: "office" as const };

    expect(equipmentDefaults(item).caseId).toBe("");
  });
});

describe("equipmentErrorMessage", () => {
  it("explains a tag in use", () => {
    expect(equipmentErrorMessage("Asset tag already in use")).toContain("já está cadastrado");
  });

  it("explains an e-mail that matches no case or several", () => {
    expect(equipmentErrorMessage("No offboarding case uses this e-mail")).toContain("Nenhum");
    expect(equipmentErrorMessage("More than one case uses this e-mail")).toContain("Mais de um");
    expect(equipmentErrorMessage("Equipment already assigned")).toContain("já está vinculado");
  });

  it("falls back for unknown errors", () => {
    expect(equipmentErrorMessage(undefined)).toContain("Tente novamente");
  });
});
