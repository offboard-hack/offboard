import type { JobPreferences, ProfileField, ProfileFields } from "@offboard/db/schema";

export type StoredPreferences = {
  mode: "automatic" | "hybrid" | "review";
  hybridThreshold: number;
  targetTitles: string[];
  jobPreferences: JobPreferences;
  profileFields: ProfileFields;
};

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
    },
  };
}
