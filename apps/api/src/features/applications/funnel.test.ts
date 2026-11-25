import { describe, expect, it } from "vitest";
import {
  saoPauloDayRange,
  summarize,
  transition,
  type ApplicationStatus,
  type ClosedReason,
  type FunnelState,
  type Stage,
} from "./funnel.js";

const stages = ["sent", "in_review", "interview", "offer"] satisfies Stage[];
const reasons = ["rejected", "withdrawn", "hired"] satisfies ClosedReason[];
const statuses = [...stages, "closed"] satisfies ApplicationStatus[];

const at = (status: Stage) =>
  ({
    status,
    closedReason: null,
    furthestStage: status,
  }) satisfies FunnelState;

const expectState = (result: FunnelState | "invalid_transition") => {
  if (result === "invalid_transition") throw new Error("unexpected invalid transition");

  return result;
};

describe("transition", () => {
  const stageMoves = stages.flatMap((from) =>
    stages.map((to) => ({ from, to, forward: stages.indexOf(to) > stages.indexOf(from) })),
  );

  it.each(stageMoves)("stage $from -> $to", ({ from, to, forward }) => {
    const result = transition(at(from), { status: to });
    expect(result).toEqual(
      forward ? { status: to, closedReason: null, furthestStage: to } : "invalid_transition",
    );
  });

  const closes = stages.flatMap((from) =>
    reasons.map((reason) => ({
      from,
      reason,
      furthest: reason === "hired" ? "offer" : from,
    })),
  );

  it.each(closes)("close $from as $reason", ({ from, reason, furthest }) => {
    expect(transition(at(from), { status: "closed", closedReason: reason })).toEqual({
      status: "closed",
      closedReason: reason,
      furthestStage: furthest,
    });
  });

  it.each(stages)("rejects closing %s without a reason", (from) => {
    expect(transition(at(from), { status: "closed" })).toBe("invalid_transition");
  });

  const reasonOnStage = stages.flatMap((from) =>
    stages.flatMap((to) => reasons.map((reason) => ({ from, to, reason }))),
  );

  it.each(reasonOnStage)("rejects reason $reason for $from -> $to", ({ from, to, reason }) => {
    expect(transition(at(from), { status: to, closedReason: reason })).toBe("invalid_transition");
  });

  const fromClosed = statuses.flatMap((to) => reasons.map((reason) => ({ to, reason })));

  it.each(fromClosed)("closed is terminal for $to / $reason", ({ to, reason }) => {
    const closed: FunnelState = {
      status: "closed",
      closedReason: reason,
      furthestStage: "interview",
    };

    expect(transition(closed, { status: to, closedReason: reason })).toBe("invalid_transition");
    expect(transition(closed, { status: to })).toBe("invalid_transition");
  });

  it("jumps from sent to offer", () => {
    expect(transition(at("sent"), { status: "offer" })).toEqual({
      status: "offer",
      closedReason: null,
      furthestStage: "offer",
    });
  });
});

describe("summarize", () => {
  it("returns zeros for no rows", () => {
    expect(summarize([])).toEqual({ sent: 0, responded: 0, interviews: 0, offers: 0 });
  });

  it("counts a sent-then-withdrawn row only as sent", () => {
    expect(summarize([{ closedReason: "withdrawn", furthestStage: "sent" }])).toEqual({
      sent: 1,
      responded: 0,
      interviews: 0,
      offers: 0,
    });
  });

  it("counts interview then rejected as interview and responded", () => {
    expect(summarize([{ closedReason: "rejected", furthestStage: "interview" }])).toEqual({
      sent: 1,
      responded: 1,
      interviews: 1,
      offers: 0,
    });
  });

  it("counts a rejection straight from sent as responded", () => {
    expect(summarize([{ closedReason: "rejected", furthestStage: "sent" }])).toEqual({
      sent: 1,
      responded: 1,
      interviews: 0,
      offers: 0,
    });
  });

  it("counts a jump to offer as responded, interview and offer", () => {
    expect(summarize([expectState(transition(at("sent"), { status: "offer" }))])).toEqual({
      sent: 1,
      responded: 1,
      interviews: 1,
      offers: 1,
    });
  });

  it("counts a hire straight from sent as responded, interview and offer", () => {
    const row = expectState(transition(at("sent"), { status: "closed", closedReason: "hired" }));
    expect(row).toEqual({ status: "closed", closedReason: "hired", furthestStage: "offer" });
    expect(summarize([row])).toEqual({
      sent: 1,
      responded: 1,
      interviews: 1,
      offers: 1,
    });
  });

  it("aggregates mixed rows", () => {
    expect(
      summarize([
        { closedReason: null, furthestStage: "sent" },
        { closedReason: null, furthestStage: "in_review" },
        { closedReason: null, furthestStage: "interview" },
        { closedReason: null, furthestStage: "offer" },
      ]),
    ).toEqual({ sent: 4, responded: 3, interviews: 2, offers: 1 });
  });
});

describe("saoPauloDayRange", () => {
  it("converts a week to a UTC range with exclusive end", () => {
    expect(saoPauloDayRange("2026-11-23", "2026-11-29")).toEqual({
      start: new Date("2026-11-23T03:00:00.000Z"),
      end: new Date("2026-11-30T03:00:00.000Z"),
    });
  });

  it("accepts a single day", () => {
    expect(saoPauloDayRange("2026-11-23", "2026-11-23")).toEqual({
      start: new Date("2026-11-23T03:00:00.000Z"),
      end: new Date("2026-11-24T03:00:00.000Z"),
    });
  });

  it("accepts exactly 31 days", () => {
    expect(saoPauloDayRange("2026-11-01", "2026-12-01")).toEqual({
      start: new Date("2026-11-01T03:00:00.000Z"),
      end: new Date("2026-12-02T03:00:00.000Z"),
    });
  });

  it("rejects 32 days", () => {
    expect(saoPauloDayRange("2026-11-01", "2026-12-02")).toBe("invalid_range");
  });

  it("rejects a reversed range", () => {
    expect(saoPauloDayRange("2026-11-24", "2026-11-23")).toBe("invalid_range");
  });

  it.each([
    "2026-02-30",
    "2026-13-01",
    "2026-11-31",
    "26-11-23",
    "2026-1-23",
    "",
    "2026-11-23T00:00",
  ])("rejects invalid date %s in either position", (value) => {
    expect(saoPauloDayRange(value, "2026-12-01")).toBe("invalid_range");
    expect(saoPauloDayRange("2026-11-01", value)).toBe("invalid_range");
  });

  it("accepts a leap day", () => {
    expect(saoPauloDayRange("2028-02-29", "2028-02-29")).toEqual({
      start: new Date("2028-02-29T03:00:00.000Z"),
      end: new Date("2028-03-01T03:00:00.000Z"),
    });
  });
});
