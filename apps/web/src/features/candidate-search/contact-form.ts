export type ContactDraft = { name: string; email: string; company: string; message: string };

export type ContactField = keyof ContactDraft;

export const emptyContact: ContactDraft = { name: "", email: "", company: "", message: "" };

export const messageLimits = { min: 20, max: 2_000 };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function contactProblems(draft: ContactDraft) {
  const problems: Partial<Record<ContactField, string>> = {};
  const name = draft.name.trim();
  const message = draft.message.trim();

  if (name.length < 2) problems.name = "Informe seu nome.";
  else if (name.length > 120) problems.name = "Use até 120 caracteres.";

  if (!emailPattern.test(draft.email.trim())) problems.email = "Informe um e-mail válido.";

  if (draft.company.trim().length > 120) problems.company = "Use até 120 caracteres.";

  if (message.length < messageLimits.min) {
    problems.message = `Escreva pelo menos ${messageLimits.min} caracteres.`;
  } else if (message.length > messageLimits.max) {
    problems.message = "Use até 2.000 caracteres.";
  }

  return problems;
}

export type ContactBody = { name: string; email: string; message: string; company?: string };

export function contactBody(draft: ContactDraft) {
  const body: ContactBody = {
    name: draft.name.trim(),
    email: draft.email.trim(),
    message: draft.message.trim(),
  };

  const company = draft.company.trim();

  if (company) body.company = company;

  return body;
}

const failures = new Map([
  [404, "Esta pessoa saiu da busca de candidatos."],
  [429, "Limite de mensagens de hoje atingido. Tente de novo amanhã."],
]);

export function contactFailure(status: number) {
  return failures.get(status) ?? "Não foi possível enviar a mensagem. Tente de novo.";
}

export function firstName(name: string) {
  return name.trim().split(/\s+/, 1).join("");
}
