import { z } from "zod";
import { isValidCpf } from "../../shared/cpf.js";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";
import { sanitizeText } from "../../shared/storable-text.js";

const states = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

const storable = () => z.string().overwrite(sanitizeText).trim();

function distinct(values: string[]) {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = value.toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}

const field = z.object({
  value: storable()
    .max(500)
    .nullable()
    .transform((value) => (value === "" ? null : value)),
  share: z.boolean(),
});

const emptyToNull = (value: string | null) => (value === "" ? null : value);

const cpfField = z.object({
  value: storable()
    .nullable()
    .transform((value) => emptyToNull(value)?.replace(/[.-]/g, "") ?? null)
    .refine((value) => value === null || isValidCpf(value)),
  share: z.boolean(),
});

const minimumAge = 14;

function isAdultEnough(birthDate: string, today: string) {
  const [year, ...rest] = today.split("-");

  return birthDate <= [Number(year) - minimumAge, ...rest].join("-");
}

function isRealDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const birthDateField = z.object({
  value: storable()
    .nullable()
    .transform((value) => emptyToNull(value))
    .refine(
      (value) =>
        value === null ||
        (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
          value >= "1900-01-01" &&
          isRealDate(value) &&
          isAdultEnough(value, saoPauloDate(new Date()))),
    ),
  share: z.boolean(),
});

const addressField = z.object({
  value: z
    .object({
      cep: storable()
        .refine((value) => /^\d{5}-?\d{3}$/.test(value))
        .transform((value) => value.replace("-", "")),
      street: storable().min(1).max(200),
      number: storable().min(1).max(20),
      complement: storable()
        .max(100)
        .nullable()
        .transform((value) => emptyToNull(value)),
      neighborhood: storable().min(1).max(100),
      city: storable().min(1).max(100),
      state: z.enum(states),
    })
    .nullable(),
  share: z.boolean(),
});

export const preferencesInputSchema = z.object({
  mode: z.enum(["automatic", "hybrid", "review"]).optional(),
  hybridThreshold: z.number().int().min(50).max(100).optional(),
  targetTitles: z.array(storable().min(2).max(100)).max(20).transform(distinct).optional(),
  jobPreferences: z
    .object({
      workModels: z.array(z.enum(["remote", "hybrid", "onsite"])).max(3),
      locations: z
        .array(z.object({ city: storable().min(1).max(100).nullable(), state: z.enum(states) }))
        .max(20),
      relocate: z.boolean(),
      salaryFloorCents: z.number().int().min(0).max(2_147_483_647).nullable(),
      seniorities: z
        .array(z.enum(["intern", "junior", "mid", "senior", "lead", "manager", "director"]))
        .max(7),
      excludedCompanies: z.array(storable().min(1).max(200)).max(50).transform(distinct),
    })
    .partial()
    .optional(),
  profileFields: z
    .object({
      phone: field,
      city: field,
      linkedin: field,
      portfolio: field,
      workAuthorization: field,
      availability: field,
      noticePeriod: field,
      salaryExpectation: field,
      cpf: cpfField,
      birthDate: birthDateField,
      address: addressField,
    })
    .partial()
    .optional(),
});

export type PreferencesInput = z.infer<typeof preferencesInputSchema>;
