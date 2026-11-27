import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preferencesInputSchema } from "./schema.js";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const parse = (value: Json) => preferencesInputSchema.safeParse(value);

describe("preferences input", () => {
  it("accepts any subset", () => {
    expect(parse({})).toMatchObject({ success: true, data: {} });
    expect(parse({ mode: "automatic" }).data).toEqual({ mode: "automatic" });
    expect(parse({ hybridThreshold: 50 }).success).toBe(true);
    expect(parse({ hybridThreshold: 100 }).success).toBe(true);
  });

  it("rejects an unknown mode and thresholds out of range", () => {
    expect(parse({ mode: "manual" }).success).toBe(false);
    expect(parse({ hybridThreshold: 49 }).success).toBe(false);
    expect(parse({ hybridThreshold: 101 }).success).toBe(false);
    expect(parse({ hybridThreshold: 75.5 }).success).toBe(false);
  });

  it("trims, sanitizes and deduplicates titles keeping the first", () => {
    expect(
      parse({ targetTitles: ["  Backend Engineer ", "backend engineer", "Dev\u0000Ops", "SRE"] })
        .data,
    ).toEqual({ targetTitles: ["Backend Engineer", "DevOps", "SRE"] });
  });

  it("limits titles by count and length", () => {
    const many = Array.from({ length: 21 }, (_, index) => `Título ${index}`);

    expect(parse({ targetTitles: many.slice(0, 20) }).success).toBe(true);
    expect(parse({ targetTitles: many }).success).toBe(false);
    expect(parse({ targetTitles: ["a"] }).success).toBe(false);
    expect(parse({ targetTitles: [" a "] }).success).toBe(false);
    expect(parse({ targetTitles: ["x".repeat(101)] }).success).toBe(false);
    expect(parse({ targetTitles: ["x".repeat(100)] }).success).toBe(true);
  });

  it("validates job preferences", () => {
    const valid = {
      workModels: ["remote", "onsite"],
      locations: [
        { city: " Campinas ", state: "SP" },
        { city: null, state: "RJ" },
      ],
      relocate: true,
      salaryFloorCents: 0,
      seniorities: ["junior", "director"],
      excludedCompanies: [" Acme ", "acme", "Globex"],
    };

    expect(parse({ jobPreferences: valid }).data?.jobPreferences).toEqual({
      ...valid,
      locations: [
        { city: "Campinas", state: "SP" },
        { city: null, state: "RJ" },
      ],
      excludedCompanies: ["Acme", "Globex"],
    });
    expect(parse({ jobPreferences: { salaryFloorCents: null } }).success).toBe(true);
    expect(parse({ jobPreferences: { salaryFloorCents: 2_147_483_647 } }).success).toBe(true);
  });

  it("rejects invalid job preferences", () => {
    const invalid: Json[] = [
      { workModels: ["moon"] },
      { locations: [{ city: null, state: "XX" }] },
      { locations: [{ city: "", state: "SP" }] },
      { locations: Array.from({ length: 21 }, () => ({ city: null, state: "SP" })) },
      { salaryFloorCents: -1 },
      { salaryFloorCents: 1.5 },
      { salaryFloorCents: 2_147_483_648 },
      { seniorities: ["god"] },
      { excludedCompanies: Array.from({ length: 51 }, (_, index) => `C${index}`) },
      { excludedCompanies: [" "] },
      { relocate: "yes" },
    ];

    for (const jobPreferences of invalid) {
      expect(parse({ jobPreferences }).success).toBe(false);
    }
  });

  it("validates profile fields and turns empty values into null", () => {
    expect(
      parse({
        profileFields: {
          phone: { value: " 11 99999-0000 ", share: true },
          city: { value: "", share: false },
          linkedin: { value: null, share: true },
        },
      }).data?.profileFields,
    ).toEqual({
      phone: { value: "11 99999-0000", share: true },
      city: { value: null, share: false },
      linkedin: { value: null, share: true },
    });
  });

  it("rejects invalid profile fields", () => {
    const invalid: Json[] = [
      { phone: { value: "x".repeat(501), share: true } },
      { phone: { value: "1" } },
      { phone: { value: 1, share: true } },
    ];

    for (const profileFields of invalid) {
      expect(parse({ profileFields }).success).toBe(false);
    }
  });

  it("accepts declared diversity values and refuses free text", () => {
    const declared = parse({
      profileFields: {
        gender: { value: "female;cis", share: true },
        race: { value: null, share: false },
        disability: { value: "no", share: false },
      },
    });

    expect(declared.success).toBe(true);
    expect(parse({ profileFields: { gender: { value: "Mulher", share: true } } }).success).toBe(
      false,
    );
    expect(parse({ profileFields: { pronoun: { value: "she;he", share: true } } }).success).toBe(
      false,
    );
  });

  describe("CPF, birth date and address", () => {
    const address = {
      cep: "01310-100",
      street: " Avenida Paulista ",
      number: "1000",
      complement: "",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const fields = (profileFields: Json) => parse({ profileFields }).data?.profileFields;

    it("stores a masked CPF as digits", () => {
      expect(fields({ cpf: { value: " 529.982.247-25 ", share: true } })).toEqual({
        cpf: { value: "52998224725", share: true },
      });
      expect(fields({ cpf: { value: "52998224725", share: false } })).toEqual({
        cpf: { value: "52998224725", share: false },
      });
      expect(fields({ cpf: { value: "", share: false } })).toEqual({
        cpf: { value: null, share: false },
      });
      expect(fields({ cpf: { value: null, share: true } })).toEqual({
        cpf: { value: null, share: true },
      });
    });

    it("rejects invalid CPFs", () => {
      for (const value of [
        "529.982.247-24",
        "111.111.111-11",
        "5299822472",
        "529 982 247 25",
        "abc",
      ]) {
        expect(parse({ profileFields: { cpf: { value, share: true } } }).success).toBe(false);
      }
    });

    it("accepts a birth date from São Paulo age 14 and up", () => {
      expect(fields({ birthDate: { value: "2012-11-25", share: true } })).toEqual({
        birthDate: { value: "2012-11-25", share: true },
      });
      expect(
        parse({ profileFields: { birthDate: { value: "2012-11-26", share: true } } }).success,
      ).toBe(false);
      expect(fields({ birthDate: { value: "1990-02-28", share: false } })).toBeDefined();
      expect(fields({ birthDate: { value: null, share: false } })).toEqual({
        birthDate: { value: null, share: false },
      });
      expect(fields({ birthDate: { value: "", share: false } })).toEqual({
        birthDate: { value: null, share: false },
      });
    });

    it("uses the São Paulo date for the age", () => {
      vi.setSystemTime(new Date("2026-11-26T02:00:00Z"));

      expect(
        parse({ profileFields: { birthDate: { value: "2012-11-25", share: true } } }).success,
      ).toBe(true);
      expect(
        parse({ profileFields: { birthDate: { value: "2012-11-26", share: true } } }).success,
      ).toBe(false);

      vi.setSystemTime(new Date("2026-11-26T03:00:00Z"));

      expect(
        parse({ profileFields: { birthDate: { value: "2012-11-26", share: true } } }).success,
      ).toBe(true);
    });

    it("rejects 13-year-olds, impossible and malformed dates", () => {
      for (const value of [
        "2013-11-25",
        "2026-02-30",
        "2025-02-29",
        "2000-13-01",
        "2000-00-10",
        "2000-01-00",
        "1899-12-31",
        "2000-1-1",
        "25/11/2000",
        "2000-01-01T00:00:00Z",
      ]) {
        expect(parse({ profileFields: { birthDate: { value, share: true } } }).success).toBe(false);
      }
    });

    it("accepts a leap day", () => {
      expect(fields({ birthDate: { value: "2000-02-29", share: true } })).toBeDefined();
    });

    it("normalizes the address", () => {
      expect(fields({ address: { value: address, share: true } })).toEqual({
        address: {
          value: { ...address, cep: "01310100", street: "Avenida Paulista", complement: null },
          share: true,
        },
      });
      expect(
        fields({
          address: { value: { ...address, cep: "01310100", complement: " Sala 2 " }, share: false },
        }),
      ).toEqual({
        address: {
          value: { ...address, cep: "01310100", street: "Avenida Paulista", complement: "Sala 2" },
          share: false,
        },
      });
      expect(
        fields({ address: { value: { ...address, complement: null }, share: false } })?.address
          ?.value?.complement,
      ).toBeNull();
      expect(fields({ address: { value: null, share: true } })).toEqual({
        address: { value: null, share: true },
      });
    });

    it("sanitizes address text", () => {
      expect(
        fields({ address: { value: { ...address, city: "S\u0000ão" }, share: true } })?.address
          ?.value?.city,
      ).toBe("São");
    });

    it("rejects invalid addresses", () => {
      const invalid: Json[] = [
        { ...address, state: "XX" },
        { ...address, state: "sp" },
        { ...address, cep: "0131010" },
        { ...address, cep: "0131-0100" },
        { ...address, cep: "abcdefgh" },
        { ...address, street: " " },
        { ...address, street: "x".repeat(201) },
        { ...address, number: "" },
        { ...address, number: "x".repeat(21) },
        { ...address, complement: "x".repeat(101) },
        { ...address, neighborhood: "" },
        { ...address, neighborhood: "x".repeat(101) },
        { ...address, city: "" },
        { ...address, city: "x".repeat(101) },
      ];

      for (const value of invalid) {
        expect(parse({ profileFields: { address: { value, share: true } } }).success).toBe(false);
      }

      expect(parse({ profileFields: { address: { value: address } } }).success).toBe(false);
    });

    it("accepts the maximum lengths", () => {
      expect(
        parse({
          profileFields: {
            address: {
              value: {
                ...address,
                street: "x".repeat(200),
                number: "x".repeat(20),
                complement: "x".repeat(100),
                neighborhood: "x".repeat(100),
                city: "x".repeat(100),
              },
              share: true,
            },
          },
        }).success,
      ).toBe(true);
    });
  });
});
