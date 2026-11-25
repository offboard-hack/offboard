import { z } from "zod";
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
    })
    .partial()
    .optional(),
});

export type PreferencesInput = z.infer<typeof preferencesInputSchema>;
