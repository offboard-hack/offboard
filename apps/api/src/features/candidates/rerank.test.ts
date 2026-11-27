import { describe, expect, it } from "vitest";
import { createReranker } from "./rerank.js";
import type { GenerateStructured } from "../../shared/ai.js";

function candidate(id: string, headline: string, distance: number) {
  return {
    id,
    name: `Person ${id}`,
    distance,
    content: {
      headline: { text: headline },
      summary: { text: "" },
      experiences: [],
      education: [],
      skills: [],
      languages: [],
      contact: { city: null },
    },
  };
}

function fakeGenerate(scores: Record<string, number>) {
  const generate: GenerateStructured = async () => {
    // WARNING: scores shape is correct for relevanceSchema; cast bypasses the generic return type
    return {
      scores: Object.entries(scores).map(([id, score]) => ({ id, score })),
    } as never;
  };

  return generate;
}

describe("createReranker", () => {
  it("reranks candidates by LLM scores", async () => {
    const rerank = createReranker(fakeGenerate({ a: 90, b: 40, c: 70 }));

    const result = await rerank("database engineer", [
      candidate("a", "DBA", 0.3),
      candidate("b", "Designer", 0.5),
      candidate("c", "Backend", 0.4),
    ]);

    expect(result.map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(result[0].match).toBe(90);
    expect(result[1].match).toBe(70);
    expect(result[2].match).toBe(40);
  });

  it("returns empty for no candidates", async () => {
    const rerank = createReranker(fakeGenerate({}));

    expect(await rerank("test", [])).toEqual([]);
  });

  it("assigns 0 to candidates missing from LLM response", async () => {
    const rerank = createReranker(fakeGenerate({ a: 80 }));

    const result = await rerank("test", [
      candidate("a", "Match", 0.3),
      candidate("b", "Missing", 0.5),
    ]);

    expect(result[0]).toMatchObject({ id: "a", match: 80 });
    expect(result[1]).toMatchObject({ id: "b", match: 0 });
  });

  it("includes experience and skills in the prompt", async () => {
    let capturedPrompt = "";

    const generate: GenerateStructured = async ({ prompt }) => {
      capturedPrompt = prompt;

      // WARNING: scores shape is correct for relevanceSchema; cast bypasses the generic return type
      return { scores: [{ id: "x", score: 50 }] } as never;
    };

    const rerank = createReranker(generate);

    await rerank("Go developer", [
      {
        id: "x",
        name: "Dev",
        distance: 0.3,
        content: {
          headline: { text: "Go Engineer" },
          summary: { text: "Backend expert." },
          experiences: [
            {
              role: "Senior Dev",
              company: "Acme",
              start: "2020",
              end: null,
              bullets: [{ text: "Built microservices" }],
            },
          ],
          education: [],
          skills: [{ name: "Go" }, { name: "Kubernetes" }],
          languages: [],
          contact: { city: null },
        },
      },
    ]);

    expect(capturedPrompt).toContain("Go developer");
    expect(capturedPrompt).toContain("Go Engineer");
    expect(capturedPrompt).toContain("Senior Dev @ Acme — Built microservices");
    expect(capturedPrompt).toContain("Go, Kubernetes");
  });

  it("omits bullet separator when experience has no bullets", async () => {
    let capturedPrompt = "";

    const generate: GenerateStructured = async ({ prompt }) => {
      capturedPrompt = prompt;

      // WARNING: scores shape is correct for relevanceSchema; cast bypasses the generic return type
      return { scores: [{ id: "y", score: 60 }] } as never;
    };

    const rerank = createReranker(generate);

    await rerank("designer", [
      {
        id: "y",
        name: "Des",
        distance: 0.4,
        content: {
          headline: { text: "Designer" },
          summary: { text: "" },
          experiences: [{ role: "Lead", company: "Studio", start: "2021", end: null, bullets: [] }],
          education: [],
          skills: [],
          languages: [],
          contact: { city: null },
        },
      },
    ]);

    expect(capturedPrompt).toContain("Lead @ Studio");
    expect(capturedPrompt).not.toContain("—");
  });
});
