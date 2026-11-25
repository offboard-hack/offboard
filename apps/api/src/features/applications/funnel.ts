export type Stage = "sent" | "in_review" | "interview" | "offer";

export type ApplicationStatus = Stage | "closed";

export type ClosedReason = "rejected" | "withdrawn" | "hired";

export type FunnelState = {
  status: ApplicationStatus;
  closedReason: ClosedReason | null;
  furthestStage: Stage;
};

const stageOrder = ["sent", "in_review", "interview", "offer"] satisfies Stage[];

const rank = (stage: Stage) => stageOrder.indexOf(stage);

export const transition = (
  current: FunnelState,
  change: { status: ApplicationStatus; closedReason?: ClosedReason },
) => {
  if (current.status === "closed") return "invalid_transition" as const;

  if (change.status === "closed") {
    if (change.closedReason === undefined) return "invalid_transition" as const;

    return {
      status: "closed",
      closedReason: change.closedReason,
      furthestStage: change.closedReason === "hired" ? "offer" : current.furthestStage,
    } satisfies FunnelState;
  }

  if (change.closedReason !== undefined || rank(change.status) <= rank(current.status)) {
    return "invalid_transition" as const;
  }

  return {
    status: change.status,
    closedReason: null,
    furthestStage: change.status,
  } satisfies FunnelState;
};

export const summarize = (rows: Pick<FunnelState, "closedReason" | "furthestStage">[]) => ({
  sent: rows.length,
  responded: rows.filter(
    (row) =>
      rank(row.furthestStage) >= rank("in_review") ||
      row.closedReason === "rejected" ||
      row.closedReason === "hired",
  ).length,
  interviews: rows.filter((row) => rank(row.furthestStage) >= rank("interview")).length,
  offers: rows.filter((row) => row.furthestStage === "offer").length,
});

const dayMs = 24 * 60 * 60 * 1000;
const maxSpanDays = 31;

const parseDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);

  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;

  return time;
};

export const saoPauloDayRange = (from: string, to: string) => {
  const fromTime = parseDay(from);
  const toTime = parseDay(to);

  if (fromTime === null || toTime === null || toTime < fromTime) return "invalid_range" as const;
  const days = (toTime - fromTime) / dayMs + 1;

  if (days > maxSpanDays) return "invalid_range" as const;
  const start = new Date(`${from}T00:00:00-03:00`);

  return { start, end: new Date(start.getTime() + days * dayMs) };
};
