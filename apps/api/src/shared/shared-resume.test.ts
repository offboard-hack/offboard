import type { ProfileFields, ResumeContent } from "@offboard/db/schema";
import { describe, expect, it } from "vitest";
import { shareFilteredResume } from "./shared-resume.js";
import { toPreferences } from "./talent-preferences.js";

const resume: ResumeContent = {
  headline: { id: "h", text: "Engenheira" },
  summary: { id: "s", text: "Resumo" },
  experiences: [],
  education: [],
  skills: [],
  languages: [],
  contact: {
    email: "ana@example.com",
    phone: "11 98888-7777",
    city: "São Paulo",
    links: ["https://www.linkedin.com/in/ana", "https://ana.dev"],
  },
};

const fieldsOf = (profileFields: ProfileFields) =>
  toPreferences({
    mode: "review",
    hybridThreshold: 75,
    targetTitles: [],
    jobPreferences: {},
    profileFields,
  }).profileFields;

describe("shareFilteredResume", () => {
  it("blanks the phone, the city and every link when nothing is shared", () => {
    expect(shareFilteredResume(resume, fieldsOf({})).contact).toEqual({
      email: "ana@example.com",
      phone: null,
      city: null,
      links: [],
    });
  });

  it("keeps shared contact values and only the links whose field is shared", () => {
    const shared = fieldsOf({
      phone: { value: null, share: true },
      city: { value: null, share: true },
      linkedin: { value: null, share: true },
    });

    expect(shareFilteredResume(resume, shared).contact).toEqual({
      email: "ana@example.com",
      phone: "11 98888-7777",
      city: "São Paulo",
      links: ["https://www.linkedin.com/in/ana"],
    });

    const portfolio = fieldsOf({ portfolio: { value: null, share: true } });

    expect(shareFilteredResume(resume, portfolio).contact.links).toEqual(["https://ana.dev"]);
  });

  it("leaves the rest of the résumé untouched", () => {
    expect(shareFilteredResume(resume, fieldsOf({})).headline).toEqual(resume.headline);
  });
});
