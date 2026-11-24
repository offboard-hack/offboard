import type { z } from "zod";
import { describe, expect, it } from "vitest";
import type { GenerateStructured } from "../../shared/ai.js";
import { extractJob, jobDraftSchema, normalizeJobUrl } from "./extract.js";

const page = {
  url: new URL("https://jobs.example.com/vaga"),
  text: "Engenheira de Software na Acme",
};

const draft = {
  isJobPosting: true,
  title: "  Engenheira de Software ",
  company: " Acme ",
  workModel: "remote" as const,
  city: " São Paulo ",
  state: "sp",
  salaryMinCents: 800000,
  salaryMaxCents: 1200000,
  description: "  Descrição da vaga  ",
};

function fake(output: Partial<z.infer<typeof jobDraftSchema>>) {
  const requests: { system: string; prompt: string }[] = [];

  const generate: GenerateStructured = async (request) => {
    requests.push({ system: request.system, prompt: request.prompt });

    return request.schema.parse({ ...draft, ...output });
  };

  return { generate, requests };
}

describe("extractJob", () => {
  it("maps a full draft", async () => {
    const { generate } = fake({});

    expect(await extractJob(generate, page)).toEqual({
      title: "Engenheira de Software",
      company: "Acme",
      workModel: "remote",
      city: "São Paulo",
      state: "SP",
      salaryMinCents: 800000,
      salaryMaxCents: 1200000,
      description: "Descrição da vaga",
    });
  });

  it("limits title, company and city to the column width", async () => {
    const long = "x".repeat(300);

    expect(
      await extractJob(fake({ title: long, company: long, city: long }).generate, page),
    ).toMatchObject({ title: "x".repeat(255), company: "x".repeat(255), city: "x".repeat(255) });
  });

  it("normalizes salary ranges", async () => {
    expect(
      await extractJob(fake({ salaryMinCents: 900000, salaryMaxCents: 750000 }).generate, page),
    ).toMatchObject({ salaryMinCents: 750000, salaryMaxCents: 900000 });
    expect(
      await extractJob(fake({ salaryMinCents: -1, salaryMaxCents: 750000 }).generate, page),
    ).toMatchObject({ salaryMinCents: null, salaryMaxCents: 750000 });
    expect(
      await extractJob(fake({ salaryMinCents: 750000, salaryMaxCents: -5 }).generate, page),
    ).toMatchObject({ salaryMinCents: 750000, salaryMaxCents: null });
    expect(
      await extractJob(fake({ salaryMinCents: null, salaryMaxCents: null }).generate, page),
    ).toMatchObject({ salaryMinCents: null, salaryMaxCents: null });
  });

  it("bounds and rounds salaries to database integers", async () => {
    expect(
      await extractJob(fake({ salaryMinCents: 750000.4, salaryMaxCents: 1.5e10 }).generate, page),
    ).toMatchObject({ salaryMinCents: 750000, salaryMaxCents: null });
    expect(
      await extractJob(fake({ salaryMinCents: 0, salaryMaxCents: 0 }).generate, page),
    ).toMatchObject({ salaryMinCents: null, salaryMaxCents: null });
    expect(
      await extractJob(fake({ salaryMinCents: 900000, salaryMaxCents: 750000.6 }).generate, page),
    ).toMatchObject({ salaryMinCents: 750001, salaryMaxCents: 900000 });
  });

  it("drops invalid states and blank optional strings", async () => {
    expect(
      await extractJob(fake({ state: "São Paulo", city: "  ", workModel: null }).generate, page),
    ).toMatchObject({ state: null, city: null, workModel: null });
    expect(await extractJob(fake({ state: null }).generate, page)).toMatchObject({ state: null });
  });

  it("caps the description", async () => {
    const result = await extractJob(fake({ description: "x".repeat(25_000) }).generate, page);

    expect(result).not.toBe("not_a_job");
    expect(result === "not_a_job" ? 0 : result.description).toHaveLength(20_000);
  });

  it("rejects pages that are not job postings", async () => {
    expect(await extractJob(fake({ isJobPosting: false }).generate, page)).toBe("not_a_job");
    expect(await extractJob(fake({ title: "   " }).generate, page)).toBe("not_a_job");
    expect(await extractJob(fake({ company: "" }).generate, page)).toBe("not_a_job");
  });

  it("sends the page and the instructions to the model", async () => {
    const { generate, requests } = fake({});

    await extractJob(generate, page);

    expect(requests[0].prompt).toContain("https://jobs.example.com/vaga");
    expect(requests[0].prompt).toContain("<page>\nEngenheira de Software na Acme\n</page>");
    expect(requests[0].system).toContain("<page>");
    expect(requests[0].system).toContain("cents");
    expect(requests[0].system).toContain("isJobPosting");
  });
});

describe("normalizeJobUrl", () => {
  it("drops tracking, sorts params and lowercases the host", () => {
    expect(
      normalizeJobUrl(new URL("https://Jobs.Example.com/vaga/?utm_source=a&b=2&a=1#apply")),
    ).toBe("https://jobs.example.com/vaga?a=1&b=2");
  });

  it("matches tracking params case-insensitively", () => {
    expect(
      normalizeJobUrl(new URL("https://jobs.example.com/vaga?UTM_Source=a&GCLID=1&FbClid=2&id=3")),
    ).toBe("https://jobs.example.com/vaga?id=3");
  });

  it("drops click ids and keeps the root path", () => {
    expect(normalizeJobUrl(new URL("https://jobs.example.com/?gclid=1&fbclid=2"))).toBe(
      "https://jobs.example.com/",
    );
  });
});
