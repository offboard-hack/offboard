export type CompanySubscription = { status: string } | null | undefined;

export const paymentReceivedNote =
  "Pagamento recebido. O plano é ativado assim que o pagamento for confirmado.";

export const paymentPendingLabel = "Pagamento pendente";

export const planChangeNote = "Mudança de plano ainda não disponível";

export const planPollInterval = 3_000;

export const planPollTimeout = 120_000;

export function planView<Subscription extends CompanySubscription>(
  subscription: Subscription,
  paid: boolean,
) {
  const status = subscription?.status;
  const paymentPending = status === "pending";
  const canSubscribe = !subscription || status === "canceled";
  const standing = canSubscribe || paymentPending ? null : subscription;

  return {
    canSubscribe,
    paymentPending,
    standing,
    changeNote: standing ? planChangeNote : null,
    paymentNote: paid && status !== "active" ? paymentReceivedNote : null,
  };
}

export function shouldPollSubscription(
  subscription: CompanySubscription,
  paid: boolean,
  elapsedMs: number,
) {
  return paid && elapsedMs < planPollTimeout && subscription?.status !== "active";
}
