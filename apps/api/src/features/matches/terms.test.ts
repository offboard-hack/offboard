import type { ResumeContent } from "@offboard/db/schema";
import { describe, expect, it } from "vitest";
import { searchTerms, toTsQuery } from "./terms.js";

function resume(overrides: Partial<ResumeContent> = {}) {
  return {
    headline: { id: "headline", text: "Engenheira de Software — C++ & Node.js" },
    summary: { id: "summary", text: "Café, café e SÃO PAULO; İstanbul ½ 2019 x\u0000yz" },
    experiences: [
      {
        id: "acme",
        company: "Empresa Secreta",
        role: "Desenvolvedora O'Reilly",
        start: "2019",
        end: null,
        bullets: [{ id: "b1", text: "Bullet não entra" }],
      },
    ],
    education: [{ id: "usp", institution: "USP", degree: "Computação", start: null, end: null }],
    skills: [
      { id: "s1", name: "C++" },
      { id: "s2", name: "&|!:*" },
      { id: "s3", name: "TypeScript" },
      { id: "s4", name: "engenheira" },
      { id: "s5", name: "Go" },
    ],
    languages: [{ id: "en", name: "Inglês", level: null }],
    contact: { email: "ana@example.com", phone: null, city: "Recife", links: [] },
    ...overrides,
  } satisfies ResumeContent;
}

describe("searchTerms", () => {
  it("builds safe search terms from the headline, roles, skills and summary", () => {
    const terms = searchTerms(resume());

    expect(terms).toEqual([
      "engenheira",
      "software",
      "node",
      "desenvolvedora",
      "reilly",
      "typescript",
      "café",
      "são",
      "paulo",
      "stanbul",
      "2019",
    ]);

    for (const term of terms) expect(term).toMatch(/^[\p{L}\p{N}]{3,}$/u);
  });

  it("keeps at most 40 distinct terms in source order", () => {
    const skills = Array.from({ length: 50 }, (_, index) => ({
      id: `s${index}`,
      name: `skill${String(index).padStart(2, "0")} skill00`,
    }));

    const terms = searchTerms(
      resume({
        headline: { id: "headline", text: "" },
        summary: { id: "summary", text: "" },
        experiences: [],
        skills,
      }),
    );

    expect(terms).toHaveLength(40);
    expect(terms[0]).toBe("skill00");
    expect(terms[1]).toBe("skill01");
    expect(terms[39]).toBe("skill39");
  });

  it("has no terms for an empty résumé", () => {
    expect(
      searchTerms(
        resume({
          headline: { id: "headline", text: "  " },
          summary: { id: "summary", text: "a b" },
          experiences: [],
          skills: [],
        }),
      ),
    ).toEqual([]);
  });
});

describe("toTsQuery", () => {
  it("joins terms as alternatives", () => {
    expect(toTsQuery(["engenheira", "typescript"])).toBe("engenheira | typescript");
    expect(toTsQuery([])).toBeNull();
  });
});
