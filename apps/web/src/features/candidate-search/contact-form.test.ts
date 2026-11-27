import { describe, expect, it } from "vitest";
import {
  confirmFailure,
  contactBody,
  contactFailure,
  contactProblems,
  emptyContact,
  firstName,
} from "./contact-form";

const valid = {
  name: " Rita ",
  email: " rita@empresa.example ",
  company: "",
  message: "Temos uma vaga que combina com você.",
};

describe("candidate contact form", () => {
  it("accepts a complete message and trims it", () => {
    expect(contactProblems(valid)).toEqual({});
    expect(contactBody(valid)).toEqual({
      name: "Rita",
      email: "rita@empresa.example",
      message: "Temos uma vaga que combina com você.",
    });
    expect(contactBody({ ...valid, company: " Empresa X " }).company).toBe("Empresa X");
  });

  it("names every missing or oversized field", () => {
    expect(contactProblems(emptyContact)).toEqual({
      name: "Informe seu nome.",
      email: "Informe um e-mail válido.",
      message: "Escreva pelo menos 20 caracteres.",
    });
    expect(
      contactProblems({
        name: "a".repeat(121),
        email: "rita@empresa.example",
        company: "b".repeat(121),
        message: "c".repeat(2_001),
      }),
    ).toEqual({
      name: "Use até 120 caracteres.",
      company: "Use até 120 caracteres.",
      message: "Use até 2.000 caracteres.",
    });
  });

  it("explains failures and greets by first name", () => {
    expect(contactFailure(404)).toMatch(/saiu da busca/);
    expect(contactFailure(429)).toMatch(/Limite/);
    expect(contactFailure(502)).toBe(
      "Não foi possível enviar o link de confirmação. Tente de novo.",
    );
    expect(confirmFailure(404)).toMatch(/expirou ou já foi usado/);
    expect(confirmFailure(429)).toMatch(/máximo de mensagens/);
    expect(confirmFailure(502)).toBe("Não foi possível enviar a mensagem. Tente de novo.");
    expect(firstName("  Marina Lopes ")).toBe("Marina");
  });
});
