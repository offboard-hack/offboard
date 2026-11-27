export type CareerPlan = {
  company: { name: string | null; includesAiApply: boolean; sponsoredUntil: string };
  individual: {
    plan: "carreira-pro";
    status: "pending" | "active" | "past_due" | "canceled";
    currentPeriodEnd: string | null;
    cancelable: boolean;
  } | null;
  benefit: {
    planName: string;
    aiApplyDailyLimit: number;
    aiApplyPriority: boolean;
    detailedScore: boolean;
    validUntil: string;
    source: "default" | "rule" | "manual";
  } | null;
  aiApply: { allowedBy: "company" | "individual" | "benefit" | null; dailyLimit: number };
  upgrade: { offered: boolean; priceCents: number; dailyLimit: number };
  copay: {
    offered: boolean;
    targetPlanId: string;
    targetPlanName: string;
    priceCents: number;
    active: boolean;
  } | null;
};

export const paymentReceivedNote =
  "Pagamento recebido. O Carreira Pro é ativado assim que o pagamento for confirmado.";

export const copayPaymentReceivedNote =
  "Pagamento recebido. O upgrade do benefício é ativado assim que o pagamento for confirmado.";

export const planPollInterval = 3_000;

export const planPollTimeout = 120_000;

const sponsorshipWarningDays = 30;

const dayMs = 86_400_000;

export function planDate(day: string) {
  const [year, month, date] = day.split("-");

  return `${date}/${month}/${year}`;
}

export function planPrice(cents: number) {
  const reais = cents / 100;

  return `R$ ${Number.isInteger(reais) ? reais : reais.toFixed(2).replace(".", ",")}/mês`;
}

export const pastDueNote = "Pagamento do Carreira Pro pendente. Verifique seu método de pagamento.";

export const checkoutPendingNote =
  "Pagamento do Carreira Pro em andamento. A confirmação pode levar alguns minutos.";

export function isProActive(plan: Pick<CareerPlan, "individual">, today: string) {
  const { individual } = plan;

  if (individual === null) return false;

  if (individual.status === "active") {
    return individual.currentPeriodEnd === null || individual.currentPeriodEnd >= today;
  }

  return (
    individual.status === "canceled" &&
    individual.currentPeriodEnd !== null &&
    individual.currentPeriodEnd >= today
  );
}

export const cancelProLabel = "Cancelar Carreira Pro";

export const cancelConfirmPrompt =
  "Cancelar o Carreira Pro? Você mantém o acesso até o fim do período já pago.";

export const cancelConfirmLabel = "Sim, cancelar";

export const cancelKeepLabel = "Manter";

export function shouldPollPlan(plan: CareerPlan | undefined, today: string, copayPaid = false) {
  if (plan === undefined) return true;

  return copayPaid ? plan.copay?.active !== true : !isProActive(plan, today);
}

function daysUntil(day: string, today: string) {
  return Math.round((Date.parse(day) - Date.parse(today)) / dayMs);
}

function upgradeState(wanted: boolean, offered: boolean) {
  if (!wanted) return "hidden" as const;

  return offered ? ("available" as const) : ("unavailable" as const);
}

function copayState(copay: CareerPlan["copay"]) {
  if (copay?.active) return "active" as const;

  return copay?.offered ? ("available" as const) : ("hidden" as const);
}

function statusNote(pastDue: boolean, checkoutPending: boolean) {
  if (pastDue) return pastDueNote;

  return checkoutPending ? checkoutPendingNote : null;
}

function proLabel(individual: CareerPlan["individual"], active: boolean) {
  if (!active || !individual) return null;

  const end = individual.currentPeriodEnd;

  if (end === null) return "Carreira Pro ativo";

  return individual.status === "canceled"
    ? `Carreira Pro cancelado · acesso até ${planDate(end)}`
    : `Carreira Pro ativo · renova em ${planDate(end)}`;
}

function benefitLine(benefit: CareerPlan["benefit"], proActive: boolean) {
  if (!benefit) return null;

  return proActive
    ? `${benefit.planName} · Patrocinado + upgrade pessoal`
    : `${benefit.planName} · Patrocinado pela empresa até ${planDate(benefit.validUntil)}`;
}

const proAiApplyDailyLimit = 10;

function benefitExpiryNote(days: number, proActive: boolean) {
  const base = `Seu benefício expira em ${days} ${days === 1 ? "dia" : "dias"}.`;

  return proActive ? base : `${base} Faça upgrade para manter o acesso.`;
}

function aiApplyLabel(dailyLimit: number, priority: boolean) {
  if (dailyLimit === 0) return "Sem candidatura com IA";

  return `${dailyLimit} candidaturas/dia com IA${priority ? " · prioridade" : ""}`;
}

export function planCardView(plan: CareerPlan, today: string, paid: boolean, copayPaid = false) {
  const { company, individual, aiApply, upgrade, benefit, copay } = plan;

  const activeBenefit = benefit !== null && benefit.validUntil >= today ? benefit : null;
  const benefitDays = activeBenefit ? daysUntil(activeBenefit.validUntil, today) : null;
  const benefitExpiring = benefitDays !== null && benefitDays <= sponsorshipWarningDays;

  const sponsorshipEnding =
    aiApply.allowedBy === "company" &&
    daysUntil(company.sponsoredUntil, today) <= sponsorshipWarningDays;

  const proActive = isProActive(plan, today);
  const pastDue = individual?.status === "past_due";
  const checkoutPending = individual?.status === "pending" && !upgrade.offered;

  const wantsUpgrade =
    !proActive &&
    !paid &&
    !pastDue &&
    !checkoutPending &&
    (aiApply.allowedBy === null || sponsorshipEnding || benefitExpiring);

  return {
    companyPlan: company.name ?? "Sua empresa não tem plano",
    aiLine: company.includesAiApply ? "Inclui candidatura com IA" : "Não inclui",
    sponsorLine:
      company.name === null
        ? null
        : `Patrocinado pela empresa até ${planDate(company.sponsoredUntil)}`,
    paymentNote: paid && !proActive,
    copayPaymentNote: copayPaid && copay?.active !== true,
    statusNote: statusNote(pastDue, checkoutPending && !paid),
    proLine: proLabel(individual, proActive),
    cancelable: individual?.cancelable === true,
    upgrade: upgradeState(wantsUpgrade, upgrade.offered),
    upgradeLabel: `Fazer upgrade · ${planPrice(upgrade.priceCents)}`,
    benefitLine: benefitLine(activeBenefit, proActive),
    benefitExpiring,
    benefitExpiryWarning:
      benefitDays !== null && benefitExpiring ? benefitExpiryNote(benefitDays, proActive) : null,
    activeBenefit,
    showComparison:
      activeBenefit !== null &&
      (!proActive || activeBenefit.aiApplyDailyLimit > proAiApplyDailyLimit),
    copayButton: copayState(copay),
    copayLabel: copay?.offered
      ? `Upgrade para ${copay.targetPlanName} · ${planPrice(copay.priceCents)}`
      : null,
    copayActiveLabel: copay?.active ? `Upgrade ativo · ${copay.targetPlanName}` : null,
    aiApplyLine: aiApplyLabel(aiApply.dailyLimit, activeBenefit?.aiApplyPriority === true),
  };
}
