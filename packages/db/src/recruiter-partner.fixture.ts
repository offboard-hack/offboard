import { createHash } from "node:crypto";

export type SeedRecruiterPartner = {
  name: string;
  company: string;
  tokenHash: string;
};

export const devRecruiterToken = "dev-recruiter-token-offboard-local";

export const seedRecruiterPartners: SeedRecruiterPartner[] = [
  {
    name: "Ana Ribeiro — Talentos Parceiros",
    company: "Talentos Parceiros",
    tokenHash: createHash("sha256").update(devRecruiterToken).digest("hex"),
  },
];
