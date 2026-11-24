import { describe, expect, it } from "vitest";
import { errorSummary } from "./error-summary.js";

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
