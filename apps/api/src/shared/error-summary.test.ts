import { describe, expect, it, vi } from "vitest";
import { errorSummary, logUnhandled } from "./error-summary.js";

describe("errorSummary", () => {
  it("keeps only the name and message of an error", () => {
    const error = Object.assign(new TypeError("gateway down"), {
      requestBodyValues: { prompt: "Marina Lopes" },
      cause: new Error("Marina Lopes"),
    });

    expect(errorSummary(error)).toStrictEqual({ name: "TypeError", message: "gateway down" });
  });

  it("describes a thrown non-error as unknown", () => {
    expect(errorSummary("timeout")).toStrictEqual({ name: "Unknown", message: "timeout" });
    expect(errorSummary(undefined)).toStrictEqual({ name: "Unknown", message: "undefined" });
  });
});

describe("logUnhandled", () => {
  it("logs the name and the database code, never the message", () => {
    const log = vi.spyOn(console, "error");

    const failure = Object.assign(new Error("insert into answers params: Marina Lopes"), {
      cause: { code: "23514", detail: "Marina Lopes" },
    });

    logUnhandled(failure);
    logUnhandled("Marina Lopes");

    expect(log.mock.calls).toEqual([
      ["unhandled error", { name: "Error", code: "23514" }],
      ["unhandled error", { name: "Unknown" }],
    ]);

    log.mockRestore();
  });
});
