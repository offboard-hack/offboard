import { describe, expect, it } from "vitest";
import type { AccountExport } from "@/entities/career";
import { canDelete, confirmationWord, exportFilename, exportJson } from "./account-data";

describe("canDelete", () => {
  it("requires the exact word", () => {
    expect(canDelete(confirmationWord, false)).toBe(true);
    expect(canDelete(`  ${confirmationWord} `, false)).toBe(true);
    expect(canDelete("apagar", false)).toBe(false);
    expect(canDelete("APAGA", false)).toBe(false);
    expect(canDelete("", false)).toBe(false);
  });

  it("stays disabled while a request runs", () => {
    expect(canDelete(confirmationWord, true)).toBe(false);
  });
});

describe("exportFilename", () => {
  it("carries the UTC date", () => {
    expect(exportFilename(new Date("2026-11-27T23:59:00Z"))).toBe("offboard-dados-2026-11-27.json");
  });
});

describe("exportJson", () => {
  it("indents the payload", () => {
    const data: AccountExport = {
      profile: {
        name: "Ana",
        email: "ana@example.com",
        sponsoredUntil: null,
        termsAcceptedAt: null,
        shareOutcomeWithHr: false,
        aiApplyConsentAt: null,
        aiApplyConsentVersion: null,
        searchableAt: null,
        firstSignedInAt: null,
        createdAt: null,
      },
      resumes: [],
      applications: [],
      matches: [],
      page: null,
      pageViews: [],
      preferences: {},
      rejections: [],
      aiApplications: [],
      answers: [],
      packages: [],
      careerSubscription: null,
    };

    expect(exportJson(data)).toBe(JSON.stringify(data, null, 2));
    expect(exportJson(data)).toContain('\n  "profile": {');
  });
});
