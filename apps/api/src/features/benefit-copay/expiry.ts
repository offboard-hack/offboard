import { logFailureCode } from "../../shared/error-summary.js";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";
import type { BenefitCopayRepository } from "./repository.js";

export async function sweepCopays(
  repo: BenefitCopayRepository,
  gateway: { cancelSubscription(id: string): Promise<void> },
  now: Date,
) {
  const today = saoPauloDate(now);

  for (const copay of await repo.expired(today)) {
    try {
      if (copay.providerSubscriptionId !== null) {
        await gateway.cancelSubscription(copay.providerSubscriptionId);
      }

      await repo.end(copay.assignmentId, now);
    } catch (cause) {
      logFailureCode("Benefit co-pay expiry failed")(cause);
    }
  }

  for (const copay of await repo.lapsed(today)) {
    await repo.settle(copay.assignmentId, today);
  }
}
