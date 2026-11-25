import { describe, expect, it } from "vitest";
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
});
