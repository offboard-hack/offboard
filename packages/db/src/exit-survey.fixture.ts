export const exitSurveyTopics = [
  "Respeito na comunicação",
  "Clareza de prazos",
  "Devolução de equipamentos",
  "Apoio emocional",
  "Acesso a benefícios",
] as const;

export type SeedExitSurvey = {
  caseName: string;
  npsScore: number;
  responses: Record<string, string | number | boolean>;
  topics: (typeof exitSurveyTopics)[number][];
  submittedAt: Date;
};

export const seedExitSurveys: readonly SeedExitSurvey[] = [
  {
    caseName: "Marina Lopes",
    npsScore: 9,
    responses: { communication: 5, deadlines: 4, wouldRecommend: true },
    topics: ["Respeito na comunicação", "Clareza de prazos"],
    submittedAt: new Date("2026-06-18T14:00:00Z"),
  },
  {
    caseName: "Rafael Mendes",
    npsScore: 7,
    responses: { communication: 4, deadlines: 3, wouldRecommend: true },
    topics: ["Respeito na comunicação", "Devolução de equipamentos"],
    submittedAt: new Date("2026-07-09T16:30:00Z"),
  },
  {
    caseName: "Bianca Souza",
    npsScore: 3,
    responses: { communication: 2, deadlines: 2, wouldRecommend: false },
    topics: ["Clareza de prazos", "Acesso a benefícios", "Apoio emocional"],
    submittedAt: new Date("2026-08-21T12:15:00Z"),
  },
  {
    caseName: "André Lima",
    npsScore: 8,
    responses: { communication: 5, deadlines: 4, wouldRecommend: true },
    topics: ["Respeito na comunicação", "Devolução de equipamentos"],
    submittedAt: new Date("2026-09-14T10:45:00Z"),
  },
  {
    caseName: "Nina Castro",
    npsScore: 6,
    responses: { communication: 3, deadlines: 3, wouldRecommend: false },
    topics: ["Clareza de prazos", "Apoio emocional"],
    submittedAt: new Date("2026-10-05T18:20:00Z"),
  },
  {
    caseName: "Gustavo Ribeiro",
    npsScore: 9,
    responses: { communication: 5, deadlines: 5, wouldRecommend: true },
    topics: ["Respeito na comunicação", "Acesso a benefícios"],
    submittedAt: new Date("2026-11-11T13:00:00Z"),
  },
];
