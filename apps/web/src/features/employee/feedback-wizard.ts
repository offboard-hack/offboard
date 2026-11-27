import { feedbackTopics, type ExitSurveyRatingKey } from "@offboard/employee/departure";
import { z } from "zod";

const rating = z.literal([1, 2, 3, 4, 5], { error: "Escolha uma nota." });

const score = z
  .number({ error: "Escolha uma nota de 0 a 10." })
  .int("Escolha uma nota de 0 a 10.")
  .min(0, "Escolha uma nota de 0 a 10.")
  .max(10, "Escolha uma nota de 0 a 10.");

const stepFields = [
  { recommendation: score, assessment: rating },
  { managerSupport: rating, teamRespect: rating },
  { communication: rating, equipmentReturn: rating, documents: rating },
  {
    topics: z.array(z.enum(feedbackTopics)).max(feedbackTopics.length),
    comment: z.string().trim().max(800, "Use até 800 caracteres."),
  },
] as const;

const stepSchemas = stepFields.map((fields) => z.object(fields));

const wizardSchema = z.object({
  anonymous: z.boolean(),
  ...stepFields[0],
  ...stepFields[1],
  ...stepFields[2],
  ...stepFields[3],
});

export const feedbackSteps = [
  { title: "Visão geral", description: "Como você avalia sua saída como um todo?" },
  { title: "Gestor e equipe", description: "Como foi a relação com quem trabalhou com você?" },
  {
    title: "Experiência do desligamento",
    description: "Como foram a comunicação, os equipamentos e os documentos?",
  },
  { title: "Comentários", description: "Conte o que marcou e o que poderia melhorar." },
] as const;

export const feedbackStepRatings: readonly (readonly {
  key: ExitSurveyRatingKey;
  question: string;
}[])[] = [
  [{ key: "assessment", question: "Qual nota você dá ao processo de desligamento?" }],
  [
    { key: "managerSupport", question: "Como foi o apoio do seu gestor?" },
    { key: "teamRespect", question: "Como foi o respeito da equipe?" },
  ],
  [
    { key: "communication", question: "A comunicação sobre a saída foi clara?" },
    { key: "equipmentReturn", question: "Como foi devolver os equipamentos?" },
    { key: "documents", question: "Como foi receber os documentos e a rescisão?" },
  ],
  [],
];

export type FeedbackWizardForm = {
  anonymous: boolean;
  recommendation: number | null;
  assessment: number | null;
  managerSupport: number | null;
  teamRespect: number | null;
  communication: number | null;
  equipmentReturn: number | null;
  documents: number | null;
  topics: (typeof feedbackTopics)[number][];
  comment: string;
};

export const feedbackWizardDefaults: FeedbackWizardForm = {
  anonymous: true,
  recommendation: null,
  assessment: null,
  managerSupport: null,
  teamRespect: null,
  communication: null,
  equipmentReturn: null,
  documents: null,
  topics: [],
  comment: "",
};

export function feedbackStepIssues(step: number, value: FeedbackWizardForm) {
  const issues: Record<string, string> = {};
  const result = stepSchemas[step].safeParse(value);

  if (!result.success) {
    for (const issue of result.error.issues) {
      issues[String(issue.path[0])] ??= issue.message;
    }
  }

  return issues;
}

export function toDepartureFeedback(value: FeedbackWizardForm) {
  return { clarity: null, respect: null, ...wizardSchema.parse(value) };
}
