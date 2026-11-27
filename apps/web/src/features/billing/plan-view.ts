export type CompanySubscription = { status: string; canRestart: boolean } | null | undefined;

export const paymentReceivedNote =
  "Pagamento recebido. O plano é ativado assim que o pagamento for confirmado.";

export const paymentPendingLabel = "Pagamento pendente";

export const planChangeNote = "Mudança de plano ainda não disponível.";

export const planPollInterval = 3_000;

export const planPollTimeout = 120_000;

export function planView<Subscription extends CompanySubscription>(
  subscription: Subscription,
  paid: boolean,
) {
  const status = subscription?.status;
  const pending = status === "pending";
  const paymentPending = pending && !subscription?.canRestart;
  const canSubscribe = !subscription || status === "canceled" || (pending && !paymentPending);
  const standing = canSubscribe || paymentPending ? null : subscription;

  return {
    canSubscribe,
    paymentPending,
    standing,
    changeNote: standing ? planChangeNote : null,
    paymentNote: paid && pending ? paymentReceivedNote : null,
  };
}

export function pollDeadline(subscription: CompanySubscription, paid: boolean, elapsedMs: number) {
  if (!paid) return null;

  return subscription?.status === "active" ? 0 : Math.max(0, planPollTimeout - elapsedMs);
}
