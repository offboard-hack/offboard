export type CareerPlan = {
  company: { name: string | null; includesAiApply: boolean; sponsoredUntil: string };
  individual: {
    plan: "carreira-pro";
    status: "pending" | "active" | "past_due" | "canceled";
    currentPeriodEnd: string | null;
  } | null;
  aiApply: { allowedBy: "company" | "individual" | null };
  upgrade: { offered: boolean; priceCents: number; dailyLimit: number };
};

export const paymentReceivedNote =
  "Pagamento recebido. O Carreira Pro é ativado assim que o pagamento for confirmado.";

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

  return (
    individual?.status === "active" &&
    (individual.currentPeriodEnd === null || individual.currentPeriodEnd >= today)
  );
}

export function shouldPollPlan(plan: CareerPlan | undefined, today: string) {
  return plan === undefined || !isProActive(plan, today);
}

function daysUntil(day: string, today: string) {
  return Math.round((Date.parse(day) - Date.parse(today)) / dayMs);
}

function upgradeState(wanted: boolean, offered: boolean) {
  if (!wanted) return "hidden" as const;

  return offered ? ("available" as const) : ("unavailable" as const);
}

function statusNote(pastDue: boolean, checkoutPending: boolean) {
  if (pastDue) return pastDueNote;

  return checkoutPending ? checkoutPendingNote : null;
}

function proLabel(individual: CareerPlan["individual"], active: boolean) {
  if (!active || !individual) return null;

  return individual.currentPeriodEnd
    ? `Carreira Pro ativo · renova em ${planDate(individual.currentPeriodEnd)}`
    : "Carreira Pro ativo";
}

export function planCardView(plan: CareerPlan, today: string, paid: boolean) {
  const { company, individual, aiApply, upgrade } = plan;

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
    (aiApply.allowedBy === null || sponsorshipEnding);

  return {
    companyPlan: company.name ?? "Sua empresa não tem plano",
    aiLine: company.includesAiApply ? "Inclui candidatura com IA" : "Não inclui",
    sponsorLine:
      company.name === null
        ? null
        : `Patrocinado pela empresa até ${planDate(company.sponsoredUntil)}`,
    paymentNote: paid && !proActive,
    statusNote: statusNote(pastDue, checkoutPending && !paid),
    proLine: proLabel(individual, proActive),
    upgrade: upgradeState(wantsUpgrade, upgrade.offered),
    upgradeLabel: `Fazer upgrade · ${planPrice(upgrade.priceCents)}`,
  };
}
