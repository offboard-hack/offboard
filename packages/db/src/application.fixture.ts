export type SeedApplicationStatus = "sent" | "in_review" | "interview" | "offer";

export type SeedApplication = {
  jobIndex: number;
  status: SeedApplicationStatus;
  appliedDaysAgo: number;
  usesTailoredResume?: boolean;
  caseName?: string;
  closedReason?: "rejected" | "hired";
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
  { jobIndex: 0, status: "interview", appliedDaysAgo: 1, usesTailoredResume: true },
  { jobIndex: 1, status: "interview", appliedDaysAgo: 6 },
  { jobIndex: 2, status: "sent", appliedDaysAgo: 5 },
  { jobIndex: 3, status: "in_review", appliedDaysAgo: 9 },
];

const cohortApplication = (
  caseName: string,
  jobIndex: number,
  status: SeedApplicationStatus,
  appliedDaysAgo: number,
  closedReason?: "rejected" | "hired",
) => ({ caseName, jobIndex, status, appliedDaysAgo, closedReason }) satisfies SeedApplication;

export const seedCohortApplications: SeedApplication[] = [
  cohortApplication("Rafael Mendes", 0, "offer", 40, "hired"),
  cohortApplication("Rafael Mendes", 1, "interview", 30, "rejected"),
  cohortApplication("Bianca Souza", 0, "offer", 38, "hired"),
  cohortApplication("Bianca Souza", 2, "in_review", 20),
  cohortApplication("André Lima", 0, "offer", 36, "hired"),
  cohortApplication("André Lima", 3, "sent", 12),
  cohortApplication("Nina Castro", 0, "offer", 10),
  cohortApplication("Nina Castro", 1, "interview", 8),
  cohortApplication("Gustavo Ribeiro", 0, "interview", 25, "rejected"),
  cohortApplication("Gustavo Ribeiro", 4, "sent", 7),
  cohortApplication("Carla Mendonça", 1, "in_review", 14),
  cohortApplication("Carla Mendonça", 2, "sent", 11),
  cohortApplication("Felipe Oliveira", 2, "sent", 9),
  cohortApplication("Felipe Oliveira", 1, "sent", 4),
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
