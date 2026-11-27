import { z } from "zod";

const failureBody = z.object({ value: z.object({ error: z.string() }) });

const reasons = new Map([
  [
    "AI Apply not available",
    "Disponível no plano Platinum Premium da sua empresa ou no Carreira Pro.",
  ],
  ["Email already in use", "Este e-mail já está ligado a outra conta de carreira."],
  [
    "Daily AI application limit reached",
    "Você atingiu o limite de 10 candidaturas com IA hoje. Tente amanhã.",
  ],
  ["Already subscribed", "Você já tem um pagamento em andamento. Tente de novo em alguns minutos."],
  ["Billing not configured", "Indisponível no momento."],
  ["Co-pay already active", "Você já tem um upgrade do benefício ativo."],
  [
    "Co-pay active",
    "Você tem um upgrade do benefício ativo. Cancele-o antes de assinar o Carreira Pro.",
  ],
  [
    "Co-pay checkout open",
    "Você já tem um pagamento de upgrade em andamento. Conclua-o ou tente de novo em alguns minutos.",
  ],
  [
    "Carreira Pro active",
    "Você já tem o Carreira Pro. Cancele-o antes de contratar o upgrade do benefício.",
  ],
  [
    "Carreira Pro checkout open",
    "Você já tem um pagamento do Carreira Pro em andamento. Tente de novo em alguns minutos.",
  ],
  ["No active co-pay", "Você não tem um upgrade do benefício ativo."],
  ["Could not cancel the co-pay", "Não foi possível cancelar o upgrade agora. Tente de novo."],
  ["Could not start the checkout", "Não foi possível abrir o pagamento. Tente de novo."],
  ["Could not cancel Carreira Pro", "Não foi possível cancelar agora. Tente de novo."],
  ["Could not cancel Carreira Pro; try again", "Não foi possível cancelar agora. Tente de novo."],
  ["No active Carreira Pro", "Você não tem um Carreira Pro ativo."],
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
  ["Résumé is empty", "Preencha o título ou uma experiência para criar o currículo."],
  ["Invalid résumé content", "Revise os dados do currículo: algum campo está longo demais."],
  ["Could not read the résumé", "Não foi possível ler o currículo. Tente outro arquivo."],
  ["Invalid answers", "Revise as respostas: alguma está incompleta ou inválida."],
  ["Résumé not ready for this job", "Seu currículo ainda não está pronto para esta vaga."],
  ["Could not read the application form", "Não foi possível ler o formulário da vaga."],
  ["Could not prepare the application", "A IA não conseguiu preparar as respostas. Tente de novo."],
  ["Could not write the cover letter", "A IA não conseguiu escrever a carta. Tente de novo."],
  ["Nothing to check", "Esta candidatura não precisa mais de confirmação."],
]);

const canceledUntil = /^Carreira Pro canceled until (\d{4})-(\d{2})-(\d{2})$/;

export function careerFailure<Failure>(status: number, failure: Failure) {
  const parsed = failureBody.safeParse(failure);
  const reason = parsed.success ? reasons.get(parsed.data.value.error) : undefined;

  if (reason) return reason;

  const until = parsed.success ? canceledUntil.exec(parsed.data.value.error) : null;

  if (until)
    return `Seu Carreira Pro cancelado ainda vale até ${until[3]}/${until[2]}/${until[1]}.`;

  if (status === 402) return "Seu acesso à carreira terminou.";

  if (status === 429) return "Limite diário de uso da IA atingido. Tente de novo amanhã.";

  if (status === 503) return "Recurso indisponível no momento.";

  return undefined;
}

export function deleteAccountFailure<Failure>(status: number, failure: Failure) {
  const parsed = failureBody.safeParse(failure);
  const reason = parsed.success ? parsed.data.value.error : undefined;

  if (status === 502 && reason === "Could not delete stored files")
    return "Não foi possível apagar seus arquivos agora. Tente de novo em alguns minutos.";

  if (status === 502)
    return "Não foi possível cancelar sua assinatura agora. Tente de novo em alguns minutos.";

  if (status === 503) return "Não é possível apagar agora. Tente mais tarde.";

  return "Não foi possível apagar sua conta. Tente de novo.";
}
