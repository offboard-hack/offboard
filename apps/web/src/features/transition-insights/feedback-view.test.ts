import { describe, expect, it } from "vitest";
import {
  barWidth,
  commentAuthorLabel,
  commentMonthLabel,
  formatNps,
  placementSummary,
  responsesLabel,
} from "./feedback-view";

const base = { isPending: false, isError: false, hiresShared: 7 };

describe("feedback view", () => {
  it("formats NPS with an explicit plus sign", () => {
    expect(formatNps(20)).toBe("+20");
    expect(formatNps(0)).toBe("0");
    expect(formatNps(-20)).toBe("-20");
  });

  it("sizes bars without dividing by zero", () => {
    expect(barWidth(1, 4)).toBe("25%");
    expect(barWidth(5, 4)).toBe("100%");
    expect(barWidth(0, 0)).toBe("0%");
  });

  it("labels comment months and authors", () => {
    expect(commentMonthLabel("2026-11")).toBe("nov de 2026");
    expect(commentAuthorLabel({ name: "Ana", department: "Produto" })).toBe("Ana · Produto");
    expect(commentAuthorLabel(null)).toBe("Anônimo");
  });

  it("pluralizes the response count", () => {
    expect(responsesLabel(1)).toBe("1 resposta");
    expect(responsesLabel(3)).toBe("3 respostas");
  });

  it("summarizes reported placements for every query state", () => {
    expect(placementSummary({ ...base, isPending: true }).value).toBe("…");
    expect(placementSummary({ ...base, isError: true }).value).toBe("—");
    expect(placementSummary({ ...base, hiresShared: null }).copy).toContain("5 pessoas");
    expect(placementSummary({ ...base, hiresShared: undefined }).value).toBe("—");
    expect(placementSummary({ ...base, hiresShared: 1 }).value).toBe("1 pessoa");
    expect(placementSummary(base).value).toBe("7 pessoas");
  });
});
