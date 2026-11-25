export type SeedJobFeed = {
  provider: "greenhouse" | "lever";
  board: string;
  companyLabel: string;
  enabled: boolean;
};

export const seedJobFeeds: SeedJobFeed[] = [
  { provider: "greenhouse", board: "quintoandar", companyLabel: "QuintoAndar", enabled: false },
  { provider: "greenhouse", board: "stone", companyLabel: "Stone", enabled: false },
];
