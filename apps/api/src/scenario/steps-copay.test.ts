import { expect, it } from "vitest";
import type { Context, Json } from "./context.js";
import type { Http, Reply } from "./http.js";
import { startReceiver } from "./receiver.js";
import { copayStanding, issuedCheckoutId, payBenefitCopay } from "./steps-copay.js";
import type { Collaborator } from "./steps.js";

const reply = (status: number, body: Json = null) =>
  ({ status, body, cookies: [] }) satisfies Reply;

function scripted(replies: Reply[], env: Record<string, string | undefined> = {}) {
  const calls: string[] = [];
  const bodies: string[] = [];
  const lines: string[] = [];

  const http: Http = async (method, path, options) => {
    calls.push(`${method} ${path}`);
    bodies.push(options?.rawBody ?? "");

    const next = replies.shift();

    if (!next) throw new Error(`Unexpected ${method} ${path}`);

    return next;
  };

  const ctx = {
    http,
    env,
    webOrigin: "http://localhost:5173",
    readCode: async () => "123456",
    seedCatalog: async () => undefined,
    startReceiver,
    newId: () => "abcdef12-0000-0000-0000-000000000000",
    today: () => "2026-11-27",
    log: (line) => lines.push(line),
    sessions: new Map(),
    logins: [],
  } satisfies Context;

  return { ctx, calls, bodies, lines };
}

const collaborator: Collaborator = {
  person: {
    caseId: "case",
    email: "p@example.com",
    name: "Pessoa",
    department: "Marketing",
    role: "Analista",
  },
  session: { cookie: "c=1" },
};

const paid = { ABACATEPAY_API_KEY: "key", ABACATEPAY_WEBHOOK_SECRET: "secret" };

const offer = {
  offered: true,
  targetPlanId: "gold-id",
  targetPlanName: "Gold",
  priceCents: 5000,
  active: false,
  endsAt: null,
};

const plan = (copay: Json, planName = "Silver") => reply(200, { benefit: { planName }, copay });

it("parses the issued checkout id from the response or the URL", () => {
  expect(issuedCheckoutId({ url: "https://x.test/pay/bill_AbC123?x=1" })).toBe("bill_AbC123");
  expect(issuedCheckoutId({ url: "https://x.test/pay/other", checkoutId: "bill_9" })).toBe(
    "bill_9",
  );
  expect(() => issuedCheckoutId({ url: "https://x.test/pay/other" })).toThrow("bill id");
});

it("reads the co-pay standing", () => {
  expect(copayStanding(null)).toBe("unavailable");
  expect(copayStanding(offer)).toBe("offered");
  expect(copayStanding({ ...offer, offered: false })).toBe("closed");
  expect(copayStanding({ ...offer, active: true })).toBe("active");
  expect(copayStanding({ ...offer, active: true, endsAt: "2026-12-27" })).toBe("canceled");
});

it("skips without the payment keys", async () => {
  const { ctx, lines } = scripted([]);

  expect(await payBenefitCopay(ctx, collaborator, "profile")).toBe("skipped");
  expect(lines).toEqual(["benefit co-pay skipped: ABACATEPAY_API_KEY not set"]);
});

it("logs and skips when there is no co-pay, it is closed, active or canceled", async () => {
  const none = scripted([plan(null)], paid);

  expect(await payBenefitCopay(none.ctx, collaborator, "profile")).toBe("unavailable");
  expect(none.lines[0]).toContain("has no co-pay on offer");

  const closed = scripted([plan({ ...offer, offered: false })], paid);

  expect(await payBenefitCopay(closed.ctx, collaborator, "profile")).toBe("closed");
  expect(closed.lines[0]).toContain("the co-pay is not offered");

  const active = scripted([plan({ ...offer, active: true }, "Gold")], paid);

  expect(await payBenefitCopay(active.ctx, collaborator, "profile")).toBe("active");
  expect(active.lines).toEqual(["Pessoa co-pay already active"]);

  const canceled = scripted([plan({ ...offer, active: true, endsAt: "2026-12-27" }, "Gold")], paid);

  expect(await payBenefitCopay(canceled.ctx, collaborator, "profile")).toBe("canceled");
  expect(canceled.lines).toEqual(["Pessoa co-pay already canceled until 2026-12-27"]);
});

const checkout = reply(200, { url: "https://pay.test/bill_77" });

function happy(overrides: { paid?: Reply; canceled?: Reply; after?: Reply } = {}) {
  return [
    plan(offer),
    checkout,
    checkout,
    reply(200),
    overrides.paid ?? plan({ ...offer, active: true }, "Gold"),
    reply(200, { endsAt: "2026-12-27" }),
    overrides.after ?? plan({ ...offer, active: true, endsAt: "2026-12-27" }, "Gold"),
  ];
}

it("starts the checkout twice, confirms with the issued bill id and cancels", async () => {
  const { ctx, calls, bodies, lines } = scripted(happy(), paid);

  expect(await payBenefitCopay(ctx, collaborator, "profile-1")).toBe("canceled");
  expect(calls).toEqual([
    "GET /me/plan",
    "POST /me/plan/copay-checkout",
    "POST /me/plan/copay-checkout",
    "POST /billing/webhook",
    "GET /me/plan",
    "POST /me/plan/copay-cancel",
    "GET /me/plan",
  ]);

  const event = JSON.parse(bodies[3]);

  expect(event.event).toBe("subscription.completed");
  expect(event.data.checkout).toEqual({
    id: "bill_77",
    externalId: "copay:profile-1:gold-id",
  });
  expect(lines).toContain("Pessoa co-pay is active and the benefit is now Gold");
  expect(lines).toContain("Pessoa canceled the co-pay; Gold stays until 2026-12-27");
});

it("fails when the repeated checkout issues another URL", async () => {
  const { ctx } = scripted(
    [plan(offer), checkout, reply(200, { url: "https://pay.test/bill_78" })],
    paid,
  );

  await expect(payBenefitCopay(ctx, collaborator, "profile")).rejects.toThrow("another URL");
});

it("fails when the payment does not activate or does not raise the tier", async () => {
  const inactive = scripted(happy({ paid: plan(offer) }), paid);

  await expect(payBenefitCopay(inactive.ctx, collaborator, "profile")).rejects.toThrow(
    "did not become active",
  );

  const same = scripted(happy({ paid: plan({ ...offer, active: true }, "Silver") }), paid);

  await expect(payBenefitCopay(same.ctx, collaborator, "profile")).rejects.toThrow(
    "effective plan is Silver, not Gold",
  );

  const missing = scripted(
    happy({ paid: reply(200, { benefit: null, copay: { ...offer, active: true } }) }),
    paid,
  );

  await expect(payBenefitCopay(missing.ctx, collaborator, "profile")).rejects.toThrow(
    "effective plan is undefined",
  );
});

it("fails when the cancellation drops access or reports another end", async () => {
  const dropped = scripted(
    happy({ after: plan({ ...offer, active: true, endsAt: "2026-12-27" }, "Silver") }),
    paid,
  );

  await expect(payBenefitCopay(dropped.ctx, collaborator, "profile")).rejects.toThrow(
    "keep access until the period end",
  );

  const moved = scripted(
    happy({ after: plan({ ...offer, active: true, endsAt: "2027-01-27" }, "Gold") }),
    paid,
  );

  await expect(payBenefitCopay(moved.ctx, collaborator, "profile")).rejects.toThrow(
    "keep access until the period end",
  );

  const gone = scripted(happy({ after: plan(null, "Gold") }), paid);

  await expect(payBenefitCopay(gone.ctx, collaborator, "profile")).rejects.toThrow(
    "keep access until the period end",
  );
});

it("describes a missing current plan when offering", async () => {
  const { ctx, lines } = scripted(
    [reply(200, { benefit: null, copay: offer }), checkout, checkout, reply(200), plan(null)],
    paid,
  );

  await expect(payBenefitCopay(ctx, collaborator, "profile")).rejects.toThrow();
  expect(lines[0]).toContain("(now no plan)");
});
