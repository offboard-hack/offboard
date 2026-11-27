import { describe, expect, it } from "vitest";
import {
  paymentReceivedNote,
  planChangeNote,
  planPollTimeout,
  planView,
  shouldPollSubscription,
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
    expect(planView({ status: "canceled" }, false)).toEqual(expected);
  });

  it("shows a pending payment without a current plan", () => {
    expect(planView({ status: "pending" }, false)).toEqual({
      canSubscribe: false,
      paymentPending: true,
      standing: null,
      changeNote: null,
      paymentNote: null,
    });
  });

  it("keeps the current plan and blocks plan changes while it stands", () => {
    const active = { status: "active" };

    expect(planView(active, false)).toEqual({
      canSubscribe: false,
      paymentPending: false,
      standing: active,
      changeNote: planChangeNote,
      paymentNote: null,
    });
    expect(planView({ status: "past_due" }, false).standing).toEqual({ status: "past_due" });
  });

  it("acknowledges the payment until the plan is active", () => {
    expect(planView({ status: "pending" }, true).paymentNote).toBe(paymentReceivedNote);
    expect(planView(null, true).paymentNote).toBe(paymentReceivedNote);
    expect(planView({ status: "active" }, true).paymentNote).toBeNull();
  });
});

describe("shouldPollSubscription", () => {
  it("polls after returning from checkout until the plan is active", () => {
    expect(shouldPollSubscription({ status: "pending" }, true, 0)).toBe(true);
    expect(shouldPollSubscription(null, true, 1_000)).toBe(true);
    expect(shouldPollSubscription({ status: "active" }, true, 0)).toBe(false);
  });

  it("gives up after two minutes and never polls without a return", () => {
    expect(shouldPollSubscription({ status: "pending" }, true, planPollTimeout)).toBe(false);
    expect(shouldPollSubscription({ status: "pending" }, false, 0)).toBe(false);
  });
});
