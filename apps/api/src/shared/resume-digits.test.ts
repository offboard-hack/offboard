import type { ResumeContent } from "@offboard/db/schema";
import { describe, expect, it } from "vitest";
import { digitRuns, resumeDigits } from "./resume-digits.js";

const content: ResumeContent = {
  headline: { id: "h", text: "Dev desde 2015" },
  summary: { id: "s", text: "Reduzi 30% do custo" },
  experiences: [
    {
      id: "e",
      company: "99",
      role: "Dev",
      start: "2019-03",
      end: null,
      bullets: [{ id: "b", text: "Atendi 120 clientes" }],
    },
  ],
  education: [{ id: "u", institution: "USP", degree: "BSc", start: "2010", end: null }],
  skills: [{ id: "k", name: "S3" }],
  languages: [{ id: "l", name: "Inglês", level: "C1" }],
  contact: { email: null, phone: "11 99999-0000", city: null, links: [] },
};

describe("resume digits", () => {
  it("lists digit runs including non-ASCII digits", () => {
    expect(digitRuns("a 12 b ٣٤")).toEqual(["12", "٣٤"]);
    expect(digitRuns(null)).toEqual([]);
  });

  it("lists superscript and other numeric runs", () => {
    expect(digitRuns("vendas em ⁴⁰% e ½")).toEqual(["⁴⁰", "½"]);
    expect(resumeDigits(content).has("⁴⁰")).toBe(false);
  });

  it("collects the digit runs of every résumé text but the contact", () => {
    expect(resumeDigits(content)).toEqual(
      new Set(["2015", "30", "99", "2019", "03", "120", "2010", "3", "1"]),
    );
  });
});
