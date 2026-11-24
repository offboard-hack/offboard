export type SeedApplicationStatus = "sent" | "in_review" | "interview" | "offer";

export type SeedApplication = {
  jobIndex: number;
  status: SeedApplicationStatus;
  appliedDaysAgo: number;
};

export type SeedInterview = {
  applicationIndex: number;
  startsInDays: number;
  mode: "video" | "in_person" | "phone";
  withWhom: string;
};

export const applicationStages: SeedApplicationStatus[] = [
  "sent",
  "in_review",
  "interview",
  "offer",
];

export const seedApplications: SeedApplication[] = [
  { jobIndex: 0, status: "interview", appliedDaysAgo: 1 },
  { jobIndex: 1, status: "interview", appliedDaysAgo: 6 },
  { jobIndex: 2, status: "sent", appliedDaysAgo: 5 },
  { jobIndex: 3, status: "in_review", appliedDaysAgo: 9 },
];

export const seedInterviews: SeedInterview[] = [
  { applicationIndex: 0, startsInDays: 2, mode: "video", withWhom: "RH da Mercado Fino" },
];

export const interviewStart = (startsInDays: number) => {
  const day = new Date(Date.now() - 3 * 3_600_000 + startsInDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  return new Date(`${day}T10:00:00-03:00`);
};
