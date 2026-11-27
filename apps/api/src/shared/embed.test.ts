import type { ResumeContent } from "@offboard/db/schema";
import { describe, expect, it } from "vitest";
import {
  jobEmbeddingText,
  profileEmbeddingText,
  resumeEmbeddingText,
  textHash,
  workersAiEmbed,
} from "./embed.js";

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

describe("profileEmbeddingText", () => {
  it("describes the whole résumé for people search, without contact details", () => {
    expect(
      profileEmbeddingText({
        ...content,
        experiences: [
          {
            id: "e1",
            role: "Tech Lead",
            company: "Acme",
            start: "2021",
            end: null,
            bullets: [{ id: "b", text: "Liderou 6 pessoas" }],
          },
          { id: "e2", role: "Dev", company: "Beta", start: "", end: "2020", bullets: [] },
        ],
        education: [
          { id: "d1", institution: "UFPE", degree: "Computação", start: "2012", end: "2016" },
          { id: "d2", institution: "Alura", degree: "Go", start: null, end: null },
        ],
        skills: [
          { id: "k1", name: "Go" },
          { id: "k2", name: "Kubernetes" },
        ],
        languages: [
          { id: "l1", name: "Inglês", level: "Fluente" },
          { id: "l2", name: "Espanhol", level: null },
        ],
        contact: {
          email: "maria@example.com",
          phone: "81 99999-0000",
          city: "Recife, PE",
          links: ["https://www.linkedin.com/in/maria"],
        },
      }),
    ).toBe(
      [
        "Engenheira de Software",
        "Backend com TypeScript.",
        "Tech Lead · Acme · 2021 – atual",
        "Liderou 6 pessoas",
        "Dev · Beta · 2020",
        "Computação · UFPE · 2012 – 2016",
        "Go · Alura",
        "Go, Kubernetes",
        "Inglês (Fluente), Espanhol",
        "Recife, PE",
      ].join("\n"),
    );
  });

  it("leaves out empty parts", () => {
    expect(
      profileEmbeddingText({
        ...content,
        summary: { id: "s", text: "" },
        experiences: [],
        skills: [],
      }),
    ).toBe("Engenheira de Software");
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

describe("textHash", () => {
  it("hashes text to a hex SHA-256 digest", async () => {
    expect(await textHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
