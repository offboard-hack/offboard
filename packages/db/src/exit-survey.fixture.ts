export const exitSurveyTopics = [
  "Respeito na comunicação",
  "Clareza de prazos",
  "Devolução de equipamentos",
  "Apoio emocional",
  "Acesso a benefícios",
] as const;

export const exitSurveyRatingKeys = [
  "assessment",
  "managerSupport",
  "teamRespect",
  "communication",
  "equipmentReturn",
  "documents",
] as const;

export type SeedExitSurvey = {
  caseName: string;
  npsScore: number;
  responses: Record<(typeof exitSurveyRatingKeys)[number], number>;
  topics: (typeof exitSurveyTopics)[number][];
  submittedAt: Date;
};

export const seedExitSurveys: readonly SeedExitSurvey[] = [
  {
    caseName: "Marina Lopes",
    npsScore: 9,
    responses: {
      assessment: 4,
      managerSupport: 5,
      teamRespect: 5,
      communication: 5,
      equipmentReturn: 4,
      documents: 4,
    },
    topics: ["Respeito na comunicação", "Clareza de prazos"],
    submittedAt: new Date("2026-06-18T14:00:00Z"),
  },
  {
    caseName: "Rafael Mendes",
    npsScore: 7,
    responses: {
      assessment: 4,
      managerSupport: 4,
      teamRespect: 4,
      communication: 4,
      equipmentReturn: 3,
      documents: 4,
    },
    topics: ["Respeito na comunicação", "Devolução de equipamentos"],
    submittedAt: new Date("2026-07-09T16:30:00Z"),
  },
  {
    caseName: "Bianca Souza",
    npsScore: 3,
    responses: {
      assessment: 2,
      managerSupport: 3,
      teamRespect: 2,
      communication: 2,
      equipmentReturn: 2,
      documents: 3,
    },
    topics: ["Clareza de prazos", "Acesso a benefícios", "Apoio emocional"],
    submittedAt: new Date("2026-08-21T12:15:00Z"),
  },
  {
    caseName: "André Lima",
    npsScore: 8,
    responses: {
      assessment: 4,
      managerSupport: 4,
      teamRespect: 5,
      communication: 5,
      equipmentReturn: 4,
      documents: 4,
    },
    topics: ["Respeito na comunicação", "Devolução de equipamentos"],
    submittedAt: new Date("2026-09-14T10:45:00Z"),
  },
  {
    caseName: "Nina Castro",
    npsScore: 6,
    responses: {
      assessment: 3,
      managerSupport: 3,
      teamRespect: 4,
      communication: 3,
      equipmentReturn: 3,
      documents: 3,
    },
    topics: ["Clareza de prazos", "Apoio emocional"],
    submittedAt: new Date("2026-10-05T18:20:00Z"),
  },
  {
    caseName: "Gustavo Ribeiro",
    npsScore: 9,
    responses: {
      assessment: 5,
      managerSupport: 5,
      teamRespect: 5,
      communication: 5,
      equipmentReturn: 5,
      documents: 4,
    },
    topics: ["Respeito na comunicação", "Acesso a benefícios"],
    submittedAt: new Date("2026-11-11T13:00:00Z"),
  },
];
