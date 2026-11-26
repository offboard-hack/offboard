import { describe, expect, it } from "vitest";
import { jobsEmpty, jobsSummary, jobsViews } from "./jobs-view";

describe("jobsViews", () => {
  it("offers compatible jobs first", () => {
    expect(jobsViews.map((item) => item.value)).toEqual(["compatible", "all"]);
  });
});

describe("jobsEmpty", () => {
  const base = { matching: false, hasResume: true, filtered: false };

  it("explains the all view", () => {
    expect(jobsEmpty({ ...base, view: "all" })).toBe("none");
    expect(jobsEmpty({ ...base, view: "all", filtered: true })).toBe("no-model");
  });

  it("prefers calculating in the compatible view", () => {
    expect(jobsEmpty({ ...base, view: "compatible", matching: true })).toBe("calculating");
    expect(
      jobsEmpty({
        ...base,
        view: "compatible",
        matching: true,
        hasResume: false,
      }),
    ).toBe("calculating");
  });

  it("falls back to the résumé or an empty list", () => {
    expect(jobsEmpty({ ...base, view: "compatible", hasResume: false })).toBe("no-resume");
    expect(jobsEmpty({ ...base, view: "compatible" })).toBe("no-compatible");
  });
});

describe("jobsSummary", () => {
  it("counts compatible jobs", () => {
    expect(jobsSummary({ view: "compatible", total: 1, hasResume: true })).toBe(
      "1 vaga compatível.",
    );
    expect(jobsSummary({ view: "compatible", total: 3, hasResume: true })).toBe(
      "3 vagas compatíveis.",
    );
  });

  it("orders all jobs by compatibility only with a résumé", () => {
    expect(jobsSummary({ view: "all", total: 2, hasResume: true })).toBe(
      "2 vagas, das mais compatíveis às menos.",
    );
    expect(jobsSummary({ view: "all", total: 1, hasResume: false })).toBe("1 vaga.");
  });
});
