import { z } from "zod";

const failureBody = z.object({ value: z.object({ error: z.string() }) });

const reasons = new Map([
  ["AI Apply not available", "Disponível no plano Platinum Premium da sua empresa."],
  ["Email already in use", "Este e-mail já está ligado a outra conta de carreira."],
  [
    "Daily AI application limit reached",
    "Você atingiu o limite de 10 candidaturas com IA hoje. Tente amanhã.",
  ],
  ["Billing not configured", "Indisponível no momento."],
  ["Could not start the checkout", "Não foi possível abrir o pagamento. Tente de novo."],
  ["Access lapsed", "Seu acesso à carreira terminou."],
  ["Upload a résumé first", "Envie seu currículo antes de continuar."],
  ["Already applied", "Você já se candidatou a esta vaga."],
  ["Already in progress", "Já existe uma candidatura com IA em andamento para esta vaga."],
  ["Draft expired", "As respostas expiraram. Prepare a candidatura de novo."],
  ["Job rejected", "Você dispensou esta vaga."],
  ["AI application pending check", "Confirme antes se a candidatura com IA foi enviada."],
  ["Résumé changed since this suggestion", "Seu currículo mudou depois desta sugestão."],
  [
    "Generate a cover letter first",
    "Esta vaga pede carta de apresentação. Gere a carta antes de confirmar.",
  ],
  ["Unsupported file", "Envie um arquivo PDF ou DOCX."],
  ["File too large", "O arquivo passa de 5 MB."],
  ["File is not a résumé", "O arquivo não parece ser um currículo."],
  ["Could not read the résumé", "Não foi possível ler o currículo. Tente outro arquivo."],
  ["Invalid answers", "Revise as respostas: alguma está incompleta ou inválida."],
  ["Résumé not ready for this job", "Seu currículo ainda não está pronto para esta vaga."],
  ["Could not read the application form", "Não foi possível ler o formulário da vaga."],
  ["Could not prepare the application", "A IA não conseguiu preparar as respostas. Tente de novo."],
  ["Could not write the cover letter", "A IA não conseguiu escrever a carta. Tente de novo."],
  ["Nothing to check", "Esta candidatura não precisa mais de confirmação."],
]);

export function careerFailure<Failure>(status: number, failure: Failure) {
  const parsed = failureBody.safeParse(failure);
  const reason = parsed.success ? reasons.get(parsed.data.value.error) : undefined;

  if (reason) return reason;

  if (status === 402) return "Seu acesso à carreira terminou.";

  if (status === 429) return "Limite diário de uso da IA atingido. Tente de novo amanhã.";

  if (status === 503) return "Recurso indisponível no momento.";

  return undefined;
}
