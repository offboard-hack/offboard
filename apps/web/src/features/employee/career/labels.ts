import { brazilTimezone } from "@offboard/employee";
import type { AiAttempt, CareerApplication, CareerJob } from "@/entities/career";

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: brazilTimezone,
});

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

export function careerDate(iso: string) {
  return dateFormat.format(new Date(iso));
}

const workModels = { remote: "Remoto", hybrid: "Híbrido", onsite: "Presencial" } as const;

export function jobPlace(job: Pick<CareerJob, "workModel" | "city" | "state">) {
  const place = [job.city, job.state].filter(Boolean).join(", ");

  if (job.workModel === "remote") return workModels.remote;

  if (job.workModel === null) return place || "Local não informado";

  return place ? `${workModels[job.workModel]} · ${place}` : workModels[job.workModel];
}

export function salaryRange(job: Pick<CareerJob, "salaryMinCents" | "salaryMaxCents">) {
  const { salaryMinCents: min, salaryMaxCents: max } = job;

  if (min !== null && max !== null) {
    return min === max
      ? money.format(min / 100)
      : `${money.format(min / 100)} – ${money.format(max / 100)}`;
  }

  if (min !== null) return `A partir de ${money.format(min / 100)}`;

  if (max !== null) return `Até ${money.format(max / 100)}`;

  return null;
}

const statuses = {
  sent: "Enviada",
  in_review: "Em análise",
  interview: "Entrevista",
  offer: "Oferta",
  closed: "Encerrada",
} as const;

const closedReasons = {
  rejected: "Não seguiu",
  withdrawn: "Você desistiu",
  hired: "Contratada",
} as const;

export function applicationStatus(application: Pick<CareerApplication, "status" | "closedReason">) {
  return application.status === "closed" && application.closedReason
    ? closedReasons[application.closedReason]
    : statuses[application.status];
}

const attemptStates = {
  draft: "Respostas para revisar",
  queued: "Na fila",
  running: "Preenchendo o formulário",
  submitting: "Enviando",
  submitted: "Enviada pela IA",
  rehearsed: "Ensaio concluído",
  assisted: "Precisa de você",
  needs_check: "Confirme o envio",
  cancelled: "Cancelada",
} as const;

export function attemptState(state: AiAttempt["state"]) {
  return attemptStates[state];
}

const attemptReasons = new Map([
  ["document_required", "A vaga pede um documento. Candidate-se pelo site da vaga."],
  ["applied_manually", "Você registrou a candidatura por conta própria."],
  ["cancelled_by_person", "Você cancelou."],
  ["consent_withdrawn", "Você retirou o consentimento para a IA."],
  ["expired", "As respostas expiraram antes da confirmação."],
  ["files_changed", "O currículo ou a carta mudou depois da confirmação."],
  ["form_changed", "O formulário da vaga mudou. Prepare as respostas de novo."],
  ["job_closed", "A vaga foi encerrada."],
  ["not_allowed", "A candidatura com IA não está disponível para sua empresa."],
  ["not_sent", "Você informou que a candidatura não foi enviada."],
  ["blocked", "O site da vaga bloqueou o preenchimento automático."],
  ["login_required", "O site da vaga pede login. Candidate-se por lá."],
  ["upload_failed", "Não foi possível anexar o currículo."],
  ["error", "O preenchimento falhou."],
]);

export function attemptReason(reason: string | null) {
  return reason === null ? null : (attemptReasons.get(reason) ?? null);
}

export function matchScore(match: CareerJob["match"]) {
  return match ? `${match.score}% compatível` : null;
}

export function evidenceValue(value: string | string[] | null) {
  if (value === null) return "Sem resposta";

  return Array.isArray(value) ? value.join("; ") || "Sem resposta" : value || "Sem resposta";
}
