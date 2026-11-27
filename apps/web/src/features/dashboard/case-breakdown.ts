import { getCaseStatus } from "../../entities/offboarding";
import type { CaseSummary } from "../../entities/offboarding";

export function caseBreakdown(cases: CaseSummary[], today: string) {
  const counts = { overdue: 0, onTrack: 0, complete: 0 };

  for (const item of cases) {
    const status = getCaseStatus(item, today);

    if (status === "overdue") counts.overdue += 1;
    else if (status === "complete") counts.complete += 1;
    else counts.onTrack += 1;
  }

  return counts;
}
