import type { JobPreferences, ProfileFields } from "./schema/index.ts";
import { normalizeQuestion } from "./question.ts";

export type SeedTalentPreferences = {
  caseName: string;
  mode: "automatic" | "hybrid" | "review";
  hybridThreshold: number;
  targetTitles: string[];
  jobPreferences: JobPreferences;
  profileFields: ProfileFields;
};

export type SeedAnswerQuestion = { text: string; normalized: string; common: boolean };

export type SeedTalentAnswer = { caseName: string; question: string; answer: string };

export type SeedJobRejection = {
  caseName: string;
  jobIndex: number;
  reason:
    | "salary"
    | "location"
    | "company"
    | "seniority"
    | "work_model"
    | "not_interested"
    | "other";
  note: string | null;
};

export const commonQuestions = [
  "Qual a sua pretensão salarial?",
  "Qual a sua disponibilidade para início?",
  "Qual o seu aviso prévio?",
  "Você se autodeclara pessoa com deficiência (PcD)?",
  "Como você soube da vaga?",
  "Você tem disponibilidade para viagens?",
  "Você aceita trabalhar no modelo presencial?",
  "Você possui CNH?",
  "Qual o seu nível de inglês?",
  "Qual o link do seu LinkedIn?",
];

export const seedAnswerQuestions: SeedAnswerQuestion[] = commonQuestions.map((text) => ({
  text,
  normalized: normalizeQuestion(text),
  common: true,
}));

const noField = { value: null, share: false };

export const seedTalentPreferences: SeedTalentPreferences[] = [
  {
    caseName: "Marina Lopes",
    mode: "hybrid",
    hybridThreshold: 75,
    targetTitles: ["Analista de Marketing", "Marketing de Produto", "Growth"],
    jobPreferences: {
      workModels: ["remote", "hybrid"],
      locations: [{ city: null, state: "SP" }],
      relocate: false,
      salaryFloorCents: null,
      seniorities: [],
      excludedCompanies: [],
    },
    profileFields: {
      phone: { value: "+55 11 91234-5678", share: false },
      city: { value: "São Paulo", share: true },
      linkedin: { value: "https://www.linkedin.com/in/marina-lopes", share: true },
      portfolio: noField,
      workAuthorization: noField,
      availability: noField,
      noticePeriod: noField,
      salaryExpectation: noField,
    },
  },
];

const marinaAnswer = (index: number, answer: string) =>
  ({
    caseName: "Marina Lopes",
    question: commonQuestions[index],
    answer,
  }) satisfies SeedTalentAnswer;

export const seedTalentAnswers: SeedTalentAnswer[] = [
  marinaAnswer(0, "R$ 9.000 a R$ 11.000, negociável conforme o pacote."),
  marinaAnswer(1, "Imediata, sem aviso prévio a cumprir."),
  marinaAnswer(2, "Não tenho aviso prévio em curso."),
  marinaAnswer(3, "Não."),
  marinaAnswer(4, "Pelo Offboard."),
  marinaAnswer(5, "Sim, com antecedência."),
  marinaAnswer(7, "Sim, categoria B."),
  marinaAnswer(9, "https://www.linkedin.com/in/marina-lopes"),
];

export const seedJobRejections: SeedJobRejection[] = [
  { caseName: "Marina Lopes", jobIndex: 4, reason: "salary", note: "Faixa abaixo do que busco." },
];
