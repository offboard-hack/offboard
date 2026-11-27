import { describe, expect, it } from "vitest";
import {
  paymentReceivedNote,
  pollDeadline,
  planChangeNote,
  planPollTimeout,
  planView,
} from "./plan-view";

describe("planView", () => {
  it("offers subscribing when the company has no subscription or a canceled one", () => {
    const expected = {
      canSubscribe: true,
      paymentPending: false,
      standing: null,
      changeNote: null,
      paymentNote: null,
    };

    expect(planView(null, false)).toEqual(expected);
    expect(planView(undefined, false)).toEqual(expected);
    expect(planView({ status: "canceled", canRestart: false }, false)).toEqual(expected);
  });

  it("shows a pending payment without a current plan", () => {
    expect(planView({ status: "pending", canRestart: false }, false)).toEqual({
      canSubscribe: false,
      paymentPending: true,
      standing: null,
      changeNote: null,
      paymentNote: null,
    });
  });

  it("offers subscribing again when the pending checkout can be restarted", () => {
    expect(planView({ status: "pending", canRestart: true }, false)).toEqual({
      canSubscribe: true,
      paymentPending: false,
      standing: null,
      changeNote: null,
      paymentNote: null,
    });
  });

  it("keeps the current plan and blocks plan changes while it stands", () => {
    const active = { status: "active", canRestart: false };

    expect(planView(active, false)).toEqual({
      canSubscribe: false,
      paymentPending: false,
      standing: active,
      changeNote: planChangeNote,
      paymentNote: null,
    });
    expect(planView({ status: "past_due", canRestart: false }, false).standing).toEqual({
      status: "past_due",
      canRestart: false,
    });
  });

  it("acknowledges the payment only while the subscription is pending", () => {
    expect(planView({ status: "pending", canRestart: false }, true).paymentNote).toBe(
      paymentReceivedNote,
    );
    expect(planView(null, true).paymentNote).toBeNull();
    expect(planView({ status: "active", canRestart: false }, true).paymentNote).toBeNull();
  });
});

describe("pollDeadline", () => {
  it("has no deadline without a checkout return", () => {
    expect(pollDeadline({ status: "pending", canRestart: false }, false, 0)).toBeNull();
  });

  it("settles at once when the plan is active", () => {
    expect(pollDeadline({ status: "active", canRestart: false }, true, 5_000)).toBe(0);
  });

  it("waits for what is left of the two minutes", () => {
    expect(pollDeadline(null, true, 20_000)).toBe(planPollTimeout - 20_000);
    expect(pollDeadline({ status: "pending", canRestart: false }, true, planPollTimeout + 1)).toBe(
      0,
    );
  });
});
