import type { ResumeContent } from "@offboard/db/schema";
import { describe, expect, it } from "vitest";
import { jobEmbeddingText, resumeEmbeddingText, workersAiEmbed } from "./embed.js";

const vector = (fill: number) => Array.from({ length: 1024 }, () => fill);

const content: ResumeContent = {
  headline: { id: "h", text: "Engenheira de Software" },
  summary: { id: "s", text: "Backend com TypeScript." },
  experiences: [
    {
      id: "e",
      role: "Desenvolvedora",
      company: "Acme",
      start: "2020-01",
      end: null,
      bullets: [],
    },
  ],
  education: [],
  skills: [{ id: "k", name: "PostgreSQL" }],
  languages: [],
  contact: { email: null, phone: null, city: null, links: [] },
};

describe("embedding texts", () => {
  it("describes a job by title, company, place, work model and plain description", () => {
    expect(
      jobEmbeddingText({
        title: "Engenheira",
        company: "Acme",
        city: "Recife",
        state: "PE",
        workModel: "remote",
        description: "<p>Vaga &amp; time</p>",
      }),
    ).toBe("Engenheira\nAcme\nRecife, PE\nremote\nVaga & time");
  });

  it("leaves out the parts a job does not have", () => {
    expect(
      jobEmbeddingText({
        title: "Engenheira",
        company: "Acme",
        city: null,
        state: "SP",
        workModel: null,
        description: "",
      }),
    ).toBe("Engenheira\nAcme\nSP");
    expect(
      jobEmbeddingText({
        title: "Engenheira",
        company: "Acme",
        city: "",
        state: null,
        workModel: null,
        description: "",
      }),
    ).toBe("Engenheira\nAcme");
  });

  it("cuts the description at 2,000 characters", () => {
    const text = jobEmbeddingText({
      title: "T",
      company: "C",
      city: null,
      state: null,
      workModel: null,
      description: `<p>${"a".repeat(5_000)}</p>`,
    });

    expect(text).toBe(`T\nC\n${"a".repeat(2_000)}`);
  });

  it("describes a résumé by titles, headline, roles, skills and summary", () => {
    expect(resumeEmbeddingText(content, ["Dev Backend"])).toBe(
      "Dev Backend\nEngenheira de Software\nDesenvolvedora\nPostgreSQL\nBackend com TypeScript.",
    );
    expect(
      resumeEmbeddingText(
        { ...content, headline: { id: "h", text: "" }, experiences: [], skills: [] },
        [],
      ),
    ).toBe("Backend com TypeScript.");
  });
});

describe("workersAiEmbed", () => {
  it("maps the Workers AI data to vectors", async () => {
    const calls: unknown[] = [];

    const embed = workersAiEmbed({
      run: async (model, input) => {
        calls.push([model, input]);

        return { data: [vector(1), vector(2)] };
      },
    });

    expect(await embed(["a", "b"])).toEqual([vector(1), vector(2)]);
    expect(calls).toEqual([["@cf/baai/bge-m3", { text: ["a", "b"] }]]);
  });

  it("rejects a vector of the wrong length", async () => {
    const embed = workersAiEmbed({ run: async () => ({ data: [[1, 2, 3]] }) });

    await expect(embed(["a"])).rejects.toThrow();
  });

  it("rejects a response without data", async () => {
    const embed = workersAiEmbed({ run: async () => ({}) });

    await expect(embed(["a"])).rejects.toThrow();
  });

  it("rejects a response with the wrong number of vectors", async () => {
    const embed = workersAiEmbed({ run: async () => ({ data: [vector(1)] }) });

    await expect(embed(["a", "b"])).rejects.toThrow("Embedding count mismatch");
  });
});
