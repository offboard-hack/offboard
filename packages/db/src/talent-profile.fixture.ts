export type SeedTalentProfile = {
  caseName: string;
  personalEmail: string;
  name: string;
  sponsoredForDays: number;
  termsAccepted?: boolean;
  signedIn?: boolean;
  shareOutcomeWithHr?: boolean;
};

export const seedTalentProfiles: SeedTalentProfile[] = [
  {
    caseName: "Marina Lopes",
    personalEmail: "marina.lopes@exemplo.com",
    name: "Marina Lopes",
    sponsoredForDays: 120,
  },
];

const cohortMember = (name: string, signedIn: boolean, shareOutcomeWithHr: boolean) =>
  ({
    caseName: name,
    personalEmail: `${name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(" ", ".")}@exemplo.com`,
    name,
    sponsoredForDays: 120,
    termsAccepted: true,
    signedIn,
    shareOutcomeWithHr,
  }) satisfies SeedTalentProfile;

export const seedCohortProfiles: SeedTalentProfile[] = [
  cohortMember("Rafael Mendes", true, true),
  cohortMember("Bianca Souza", true, true),
  cohortMember("André Lima", true, false),
  cohortMember("Nina Castro", true, false),
  cohortMember("Gustavo Ribeiro", true, false),
  cohortMember("Carla Mendonça", false, false),
  cohortMember("Felipe Oliveira", false, false),
];
