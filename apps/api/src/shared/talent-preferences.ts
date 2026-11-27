import type { JobPreferences, ProfileField, ProfileFields } from "@offboard/db/schema";

export type StoredPreferences = {
  mode: "automatic" | "hybrid" | "review";
  hybridThreshold: number;
  targetTitles: string[];
  jobPreferences: JobPreferences;
  profileFields: ProfileFields;
};

export type ProfileFill = Partial<
  Record<"phone" | "linkedin" | "portfolio" | "city" | "cpf", string>
>;

function field(stored: ProfileField | undefined) {
  return { value: stored?.value ?? null, share: stored?.share ?? false };
}

export function toPreferences(row: StoredPreferences | undefined) {
  const jobs = row?.jobPreferences ?? {};
  const fields = row?.profileFields ?? {};

  return {
    mode: row?.mode ?? "review",
    hybridThreshold: row?.hybridThreshold ?? 75,
    targetTitles: row?.targetTitles ?? [],
    jobPreferences: {
      workModels: jobs.workModels ?? [],
      locations: jobs.locations ?? [],
      relocate: jobs.relocate ?? false,
      salaryFloorCents: jobs.salaryFloorCents ?? null,
      seniorities: jobs.seniorities ?? [],
      excludedCompanies: jobs.excludedCompanies ?? [],
    },
    profileFields: {
      phone: field(fields.phone),
      city: field(fields.city),
      linkedin: field(fields.linkedin),
      portfolio: field(fields.portfolio),
      workAuthorization: field(fields.workAuthorization),
      availability: field(fields.availability),
      noticePeriod: field(fields.noticePeriod),
      salaryExpectation: field(fields.salaryExpectation),
      cpf: field(fields.cpf),
      birthDate: field(fields.birthDate),
      address: { value: fields.address?.value ?? null, share: fields.address?.share ?? false },
      gender: field(fields.gender),
      race: field(fields.race),
      orientation: field(fields.orientation),
      disability: field(fields.disability),
      pronoun: field(fields.pronoun),
    },
  };
}
