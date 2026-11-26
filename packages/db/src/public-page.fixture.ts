export type SeedPublicPage = {
  caseName: string;
  slug: string;
  enabled: boolean;
  dailyVisits: number[];
  dailyRecruiterVisits: number[];
};

export const seedPublicPages: SeedPublicPage[] = [
  {
    caseName: "Marina Lopes",
    slug: "marina-lopes",
    enabled: true,
    dailyVisits: [3, 4, 7, 4, 8, 2, 3],
    dailyRecruiterVisits: [0, 1, 2, 0, 2, 0, 1],
  },
];

export const saoPauloDaysEndingToday = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.now() - 3 * 3_600_000 - (count - 1 - index) * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );

export const publicToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));

  return Buffer.from(bytes).toString("base64url");
};
