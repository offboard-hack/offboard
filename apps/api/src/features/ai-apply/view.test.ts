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
    });
  });

  it("serializes the confirmation time", () => {
    const confirmedAt = new Date("2026-11-25T11:00:00Z");

    expect(toAttemptView({ ...row, confirmedAt }, job).confirmedAt).toBe(
      "2026-11-25T11:00:00.000Z",
    );
  });
});
