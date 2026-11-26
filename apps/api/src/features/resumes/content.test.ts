import type { ResumeContent as StoredResumeContent } from "@offboard/db/schema";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
  resumeContentInputSchema,
  resumeContentSchema,
  withNodeIds,
  type ResumeContent,
  type ResumeContentInput,
} from "./content.js";

const input: ResumeContentInput = {
  headline: { text: "Engenheira de Software" },
  summary: { id: "summary", text: "Dez anos de backend." },
  experiences: [
    {
      company: "Acme",
      role: "Engenheira",
      start: "2019-03",
      end: null,
      bullets: [{ text: "Liderou a migração" }, { id: "bullet", text: "Mentorou o time" }],
    },
  ],
  education: [{ institution: "USP", degree: "Computação", start: null, end: "2014" }],
  skills: [{ name: "TypeScript" }],
  languages: [{ id: "language", name: "Inglês", level: "Fluente" }],
  contact: { email: "ana@example.com", phone: null, city: "São Paulo", links: [] },
};

function sequence() {
  let next = 0;

  return () => `node-${++next}`;
}

describe("resume content", () => {
  it("keeps the schema and the stored column type equal", () => {
    expectTypeOf<z.infer<typeof resumeContentSchema>>().toEqualTypeOf<StoredResumeContent>();
    expectTypeOf<ResumeContent>().toEqualTypeOf<StoredResumeContent>();
    expectTypeOf(withNodeIds).returns.toEqualTypeOf<StoredResumeContent | "duplicate_ids">();
  });

  it("assigns and validates node ids", () => {
    expect(withNodeIds(input, sequence())).toEqual({
      headline: { id: "node-1", text: "Engenheira de Software" },
      summary: { id: "summary", text: "Dez anos de backend." },
      experiences: [
        {
          id: "node-2",
          company: "Acme",
          role: "Engenheira",
          start: "2019-03",
          end: null,
          bullets: [
            { id: "node-3", text: "Liderou a migração" },
            { id: "bullet", text: "Mentorou o time" },
          ],
        },
      ],
      education: [
        { id: "node-4", institution: "USP", degree: "Computação", start: null, end: "2014" },
      ],
      skills: [{ id: "node-5", name: "TypeScript" }],
      languages: [{ id: "language", name: "Inglês", level: "Fluente" }],
      contact: { email: "ana@example.com", phone: null, city: "São Paulo", links: [] },
    });

    expect(
      withNodeIds({ ...input, skills: [{ id: "summary", name: "TypeScript" }] }, sequence()),
    ).toBe("duplicate_ids");
    expect(withNodeIds(input, () => "same")).toBe("duplicate_ids");

    const generated = withNodeIds(input);

    expect(generated).not.toBe("duplicate_ids");
    expect(resumeContentSchema.safeParse(generated).success).toBe(true);
  });

  it("trims strings and enforces limits", () => {
    const content = withNodeIds(input, sequence());

    if (content === "duplicate_ids") throw new Error("expected content");

    const parsed = resumeContentSchema.parse({
      ...content,
      headline: { id: "  head  ", text: "  Engenheira  " },
    });

    expect(parsed.headline).toEqual({ id: "head", text: "Engenheira" });

    const accepts = (override: Partial<ResumeContent>) =>
      resumeContentSchema.safeParse({ ...content, ...override }).success;

    expect(accepts({ headline: { id: "   ", text: "x" } })).toBe(false);
    expect(accepts({ headline: { id: "x".repeat(65), text: "x" } })).toBe(false);
    expect(accepts({ headline: { id: "x".repeat(64), text: "x".repeat(2_000) } })).toBe(true);
    expect(accepts({ headline: { id: "head", text: "x".repeat(2_001) } })).toBe(false);
    expect(
      accepts({
        skills: Array.from({ length: 51 }, (_, index) => ({ id: `s${index}`, name: "x" })),
      }),
    ).toBe(false);
    expect(
      accepts({
        experiences: [
          {
            id: "e",
            company: "Acme",
            role: "Dev",
            start: "2020",
            end: null,
            bullets: Array.from({ length: 21 }, (_, index) => ({ id: `b${index}`, text: "x" })),
          },
        ],
      }),
    ).toBe(false);
    expect(
      accepts({
        contact: {
          email: null,
          phone: null,
          city: null,
          links: Array.from({ length: 51 }, () => "x"),
        },
      }),
    ).toBe(false);
  });

  it("accepts input without ids", () => {
    expect(resumeContentInputSchema.parse(input)).toEqual(input);
    expect(resumeContentSchema.safeParse(input).success).toBe(false);
  });

  it("removes characters the database cannot store", () => {
    const parsed = resumeContentInputSchema.parse({
      ...input,
      headline: { id: "a\u0000b", text: "a\u0000b" },
      summary: { text: "\ud800x" },
      skills: [{ name: "x\udc00" }, { name: "😀 ok" }],
      contact: { ...input.contact, links: ["\u0000\u0000 https://ana.dev"] },
    });

    expect(parsed.headline).toEqual({ id: "ab", text: "ab" });
    expect(parsed.summary.text).toBe("\uFFFDx");
    expect(parsed.skills).toEqual([{ name: "x\uFFFD" }, { name: "😀 ok" }]);
    expect(parsed.contact.links).toEqual(["https://ana.dev"]);
    const content = withNodeIds(parsed);

    if (content === "duplicate_ids") throw new Error("expected content");

    expect(
      resumeContentSchema.safeParse({ ...content, headline: { id: "\u0000", text: "" } }).success,
    ).toBe(false);
  });
});
