export type SeedTalentProfile = {
  caseName: string;
  personalEmail: string;
  name: string;
  sponsoredForDays: number;
};

export const seedTalentProfiles: SeedTalentProfile[] = [
  {
    caseName: "Marina Lopes",
    personalEmail: "marina.lopes@exemplo.com",
    name: "Marina Lopes",
    sponsoredForDays: 120,
  },
];
