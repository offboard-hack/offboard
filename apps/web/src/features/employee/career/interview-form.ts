import type { InterviewInput } from "@/entities/career";

export const interviewModes = [
  { value: "video", label: "Vídeo" },
  { value: "in_person", label: "Presencial" },
  { value: "phone", label: "Telefone" },
] as const;

export type InterviewDraft = {
  date: string;
  time: string;
  mode: InterviewInput["mode"];
  with: string;
  notes: string;
};

export type InterviewField = "date" | "time" | "with" | "notes";

export const emptyInterviewDraft: InterviewDraft = {
  date: "",
  time: "",
  mode: "video",
  with: "",
  notes: "",
};

export function interviewProblems(draft: InterviewDraft) {
  const problems: Partial<Record<InterviewField, string>> = {};

  if (!draft.date) problems.date = "Escolha o dia da entrevista.";

  if (!draft.time) problems.time = "Informe o horário.";

  if (!draft.with.trim()) problems.with = "Informe com quem será a entrevista.";
  else if (draft.with.trim().length > 255) problems.with = "Use até 255 caracteres.";

  if (draft.notes.trim().length > 2000) problems.notes = "Use até 2000 caracteres.";

  return problems;
}

export function interviewInput(draft: InterviewDraft) {
  return {
    startsAt: `${draft.date}T${draft.time}:00-03:00`,
    mode: draft.mode,
    with: draft.with.trim(),
    notes: draft.notes.trim(),
  } satisfies InterviewInput;
}

export function interviewMode(value: string) {
  return interviewModes.find((mode) => mode.value === value)?.value ?? emptyInterviewDraft.mode;
}
