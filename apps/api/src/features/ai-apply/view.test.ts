import { describe, expect, it } from "vitest";
import { toAttemptView } from "./view.js";

const row: Parameters<typeof toAttemptView>[0] = {
  id: "a1",
  state: "queued",
  reason: null,
  form: { questions: [] },
  draft: [],
  confirmed: null,
  rehearsal: true,
  preparedAt: new Date("2026-11-25T10:00:00Z"),
  confirmedAt: null,
  evidence: null,
  screenshotKey: null,
  liveUrl: null,
};

const job = { id: "j1", title: "Backend", company: "Acme", url: "https://example.com/j1" };

describe("toAttemptView", () => {
  it("maps the stored attempt and its job to the response shape", () => {
    expect(toAttemptView(row, job)).toEqual({
      id: "a1",
      job,
      state: "queued",
      reason: null,
      questions: [],
      answers: [],
      confirmed: null,
      rehearsal: true,
      preparedAt: "2026-11-25T10:00:00.000Z",
      confirmedAt: null,
      evidence: null,
      hasScreenshot: false,
      liveUrl: null,
    });
  });

  it("shows the live view only while the browser is working", () => {
    const liveUrl = "https://www.browserbase.com/devtools-fullscreen/inspector.html?navbar=false";

    for (const state of ["running", "submitting"] as const) {
      expect(toAttemptView({ ...row, state, liveUrl }, job).liveUrl).toBe(liveUrl);
    }

    for (const state of ["queued", "rehearsed", "assisted", "needs_check", "submitted"] as const) {
      expect(toAttemptView({ ...row, state, liveUrl }, job).liveUrl).toBeNull();
    }
  });

  it("exposes the evidence and whether a screenshot exists without leaking its key", () => {
    const evidence = {
      fields: [{ question: "E-mail", value: "ana@example.com" }],
      files: ["curriculo.pdf"],
      finalUrl: "https://example.com/ok",
    };

    const view = toAttemptView({ ...row, evidence, screenshotKey: "ai-applications/p/a.png" }, job);

    expect(view).toMatchObject({
      evidence: { ...evidence, failedField: null, formErrors: [] },
      hasScreenshot: true,
    });
    expect(
      toAttemptView(
        { ...row, evidence: { ...evidence, failedField: "Telefone", formErrors: ["Obrigatório"] } },
        job,
      ).evidence,
    ).toEqual({ ...evidence, failedField: "Telefone", formErrors: ["Obrigatório"] });
    expect(JSON.stringify(view)).not.toContain("ai-applications/p/a.png");
  });

  it("serializes the confirmation time", () => {
    const confirmedAt = new Date("2026-11-25T11:00:00Z");

    expect(toAttemptView({ ...row, confirmedAt }, job).confirmedAt).toBe(
      "2026-11-25T11:00:00.000Z",
    );
  });
});
