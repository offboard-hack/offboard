import type { RejectionReason } from "@/entities/career";

const labels = {
  not_interested: "Não tenho interesse",
  salary: "Salário",
  location: "Local",
  work_model: "Modelo de trabalho",
  seniority: "Senioridade",
  company: "Empresa",
  other: "Outro motivo",
} satisfies Record<RejectionReason, string>;

const order = [
  "not_interested",
  "salary",
  "location",
  "work_model",
  "seniority",
  "company",
  "other",
] as const satisfies RejectionReason[];

export const rejectionReasons = order.map((value) => ({ value, label: labels[value] }));

export function rejectionLabel(reason: RejectionReason) {
  return labels[reason];
}

export function rejectionNote(note: string) {
  const text = note.trim();

  if (text.length > 500) return { problem: "Use até 500 caracteres." } as const;

  return { note: text === "" ? null : text } as const;
}
