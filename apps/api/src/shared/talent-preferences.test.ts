import { describe, expect, it } from "vitest";
import { toPreferences } from "./talent-preferences.js";

const empty = { value: null, share: false };

describe("talent preferences view", () => {
  it("fills every default when nothing is stored", () => {
    expect(toPreferences(undefined)).toEqual({
      mode: "review",
      hybridThreshold: 75,
      targetTitles: [],
      jobPreferences: {
        workModels: [],
        locations: [],
        relocate: false,
        salaryFloorCents: null,
        seniorities: [],
        excludedCompanies: [],
      },
      profileFields: {
        phone: empty,
        city: empty,
        linkedin: empty,
        portfolio: empty,
        workAuthorization: empty,
        availability: empty,
        noticePeriod: empty,
        salaryExpectation: empty,
        cpf: empty,
        birthDate: empty,
        address: empty,
      },
    });
  });

  it("keeps stored values and defaults the missing keys", () => {
    const view = toPreferences({
      mode: "hybrid",
      hybridThreshold: 90,
      targetTitles: ["Backend"],
      jobPreferences: {
        workModels: ["remote"],
        locations: [{ city: null, state: "SP" }],
        relocate: true,
        salaryFloorCents: 500000,
        seniorities: ["senior"],
        excludedCompanies: ["Acme"],
      },
      profileFields: { phone: { value: "1199", share: true } },
    });

    expect(view.mode).toBe("hybrid");
    expect(view.hybridThreshold).toBe(90);
    expect(view.targetTitles).toEqual(["Backend"]);
    expect(view.jobPreferences).toEqual({
      workModels: ["remote"],
      locations: [{ city: null, state: "SP" }],
      relocate: true,
      salaryFloorCents: 500000,
      seniorities: ["senior"],
      excludedCompanies: ["Acme"],
    });
    expect(view.profileFields.phone).toEqual({ value: "1199", share: true });
    expect(view.profileFields.city).toEqual(empty);
  });

  it("defaults only the missing job preference keys", () => {
    const view = toPreferences({
      mode: "review",
      hybridThreshold: 75,
      targetTitles: [],
      jobPreferences: { relocate: true },
      profileFields: {},
    });

    expect(view.jobPreferences).toEqual({
      workModels: [],
      locations: [],
      relocate: true,
      salaryFloorCents: null,
      seniorities: [],
      excludedCompanies: [],
    });
  });

  it("keeps stored CPF, birth date and address", () => {
    const address = {
      cep: "01310100",
      street: "Avenida Paulista",
      number: "1000",
      complement: null,
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    };

    const view = toPreferences({
      mode: "review",
      hybridThreshold: 75,
      targetTitles: [],
      jobPreferences: {},
      profileFields: {
        cpf: { value: "52998224725", share: true },
        birthDate: { value: "1990-05-17", share: false },
        address: { value: address, share: true },
      },
    });

    expect(view.profileFields.cpf).toEqual({ value: "52998224725", share: true });
    expect(view.profileFields.birthDate).toEqual({ value: "1990-05-17", share: false });
    expect(view.profileFields.address).toEqual({ value: address, share: true });
  });
});
