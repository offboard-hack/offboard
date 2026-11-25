import { describe, expect, it } from "vitest";
import { formatAddress, formatBirthDate, formatCep, formatCpf } from "./profile-formats.js";

const address = {
  cep: "01310100",
  street: "Avenida Paulista",
  number: "1000",
  complement: null,
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

describe("profile formats", () => {
  it("masks the CPF, the CEP and the birth date", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(formatCep("01310100")).toBe("01310-100");
    expect(formatBirthDate("1990-05-17")).toBe("17/05/1990");
  });

  it("writes the address on one line, with the complement when present", () => {
    expect(formatAddress(address)).toBe(
      "Avenida Paulista, 1000 - Bela Vista, São Paulo - SP, CEP 01310-100",
    );
    expect(formatAddress({ ...address, complement: "Sala 2" })).toBe(
      "Avenida Paulista, 1000 - Sala 2 - Bela Vista, São Paulo - SP, CEP 01310-100",
    );
  });
});
