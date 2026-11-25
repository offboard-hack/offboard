import { describe, expect, it, vi } from "vitest";
import { fetchFeed } from "./sources.js";

const recordingFetch = (...responses: Response[]) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });

    const next = responses.shift();

    if (next === undefined) throw new Error(`unexpected fetch of ${String(input)}`);

    return next;
  };

  return { calls, fetchImpl };
};

const json = <Body>(body: Body) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const greenhouse = { provider: "greenhouse" as const, board: "acme", companyLabel: null };
const lever = { provider: "lever" as const, board: "acme-corp_br", companyLabel: null };

const greenhouseJob = <Fields extends object>(id: number, fields?: Fields) => ({
  id,
  internal_job_id: id + 1,
  title: "Engenheira de Dados",
  company_name: "Acme Pagamentos",
  absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
  location: { name: "Sao Paulo, Sao Paulo, Brasil" },
  first_published: "2026-11-02T10:15:00-03:00",
  updated_at: "2026-11-20T09:00:00-03:00",
  language: "pt-BR",
  requisition_id: "R-1",
  data_compliance: [],
  metadata: null,
  departments: [{ id: 1, name: "Data", child_ids: [], parent_id: null }],
  offices: [{ id: 2, name: "São Paulo", location: "Sao Paulo, Brasil", child_ids: [] }],
  content:
    "&lt;div class=&quot;content-intro&quot;&gt;&lt;p&gt;Venha &lt;strong&gt;construir&lt;/strong&gt; pipelines&amp;nbsp;&amp;amp; modelos.&lt;/p&gt;&lt;/div&gt;&lt;ul&gt;&lt;li&gt;SQL &amp;lt;3&lt;/li&gt;&lt;/ul&gt;",
  ...fields,
});

const leverPosting = <Fields extends object>(id: string, fields?: Fields) => ({
  id,
  text: "Backend Engineer",
  hostedUrl: `https://jobs.lever.co/acme-corp_br/${id}`,
  applyUrl: `https://jobs.lever.co/acme-corp_br/${id}/apply`,
  categories: {
    commitment: "Full-time",
    department: "Engineering",
    location: "Curitiba, PR, Brazil",
    team: "Platform",
    allLocations: ["Curitiba, PR, Brazil"],
  },
  workplaceType: "hybrid",
  country: "BR",
  createdAt: 1_764_000_000_000,
  description: "<div>We build payments.</div>",
  descriptionPlain: "We build payments.\n",
  additionalPlain: "  Benefits included.  ",
  additional: "<div>Benefits included.</div>",
  lists: [{ text: "Requirements", content: "<li>Go</li>" }],
  ...fields,
});

describe("fetchFeed", () => {
  it("maps Greenhouse jobs from the fixed host", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    const { calls, fetchImpl } = recordingFetch(
      json({ jobs: [greenhouseJob(4012345)], meta: { total: 1 } }),
    );

    const result = await fetchFeed(greenhouse, fetchImpl);

    expect(result).toEqual({
      jobs: [
        {
          sourceKey: "acme:4012345",
          title: "Engenheira de Dados",
          company: "Acme Pagamentos",
          workModel: null,
          city: "Sao Paulo",
          state: "SP",
          url: "https://job-boards.greenhouse.io/acme/jobs/4012345",
          description: "Venha construir pipelines & modelos. SQL <3",
          postedAt: new Date("2026-11-02T13:15:00.000Z"),
        },
      ],
      skipped: 0,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true");
    expect(calls[0]?.init?.headers).toEqual({ accept: "application/json" });
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(calls[0]?.init?.signal).toBe(timeout.mock.results[0]?.value);

    timeout.mockRestore();
  });

  it("maps Lever postings from the fixed host", async () => {
    const { calls, fetchImpl } = recordingFetch(
      json([
        leverPosting("0f8a1c3e-1111-4c8e-9a1b-2c3d4e5f6a7b"),
        leverPosting("b2", {
          text: "Designer (Remoto)",
          workplaceType: "unspecified",
          country: null,
          categories: { location: "Remote - Brazil", allLocations: [] },
          createdAt: null,
          descriptionPlain: null,
          additionalPlain: null,
        }),
        leverPosting("b3", {
          workplaceType: "onsite",
          country: "US",
          categories: { location: "New York, NY", allLocations: ["New York, NY", "Recife - PE"] },
        }),
        leverPosting("b4", {
          workplaceType: "remote",
          country: "BR",
          categories: { location: "Anywhere" },
        }),
        leverPosting("b5", { categories: null, workplaceType: 3, country: "BR" }),
      ]),
    );

    const result = await fetchFeed(lever, fetchImpl);

    expect(calls[0]?.url).toBe("https://api.lever.co/v0/postings/acme-corp_br?mode=json");
    expect(result).toEqual({
      jobs: [
        {
          sourceKey: "acme-corp_br:0f8a1c3e-1111-4c8e-9a1b-2c3d4e5f6a7b",
          title: "Backend Engineer",
          company: "Acme Corp Br",
          workModel: "hybrid",
          city: "Curitiba",
          state: "PR",
          url: "https://jobs.lever.co/acme-corp_br/0f8a1c3e-1111-4c8e-9a1b-2c3d4e5f6a7b",
          description: "We build payments.\n\nBenefits included.",
          postedAt: new Date(1_764_000_000_000),
        },
        {
          sourceKey: "acme-corp_br:b2",
          title: "Designer (Remoto)",
          company: "Acme Corp Br",
          workModel: "remote",
          city: null,
          state: null,
          url: "https://jobs.lever.co/acme-corp_br/b2",
          description: "",
          postedAt: null,
        },
        {
          sourceKey: "acme-corp_br:b3",
          title: "Backend Engineer",
          company: "Acme Corp Br",
          workModel: "onsite",
          city: "Recife",
          state: "PE",
          url: "https://jobs.lever.co/acme-corp_br/b3",
          description: "We build payments.\n\nBenefits included.",
          postedAt: new Date(1_764_000_000_000),
        },
        {
          sourceKey: "acme-corp_br:b4",
          title: "Backend Engineer",
          company: "Acme Corp Br",
          workModel: "remote",
          city: null,
          state: null,
          url: "https://jobs.lever.co/acme-corp_br/b4",
          description: "We build payments.\n\nBenefits included.",
          postedAt: new Date(1_764_000_000_000),
        },
        {
          sourceKey: "acme-corp_br:b5",
          title: "Backend Engineer",
          company: "Acme Corp Br",
          workModel: null,
          city: null,
          state: null,
          url: "https://jobs.lever.co/acme-corp_br/b5",
          description: "We build payments.\n\nBenefits included.",
          postedAt: new Date(1_764_000_000_000),
        },
      ],
      skipped: 0,
    });
  });

  it("keeps minimal items whose optional fields are absent", async () => {
    const { fetchImpl } = recordingFetch(
      json({
        jobs: [
          {
            id: 7,
            title: "Analista",
            absolute_url: "https://job-boards.greenhouse.io/acme/jobs/7",
            location: { name: "Brasil" },
          },
        ],
      }),
      json([
        {
          id: "m1",
          text: "Analista",
          hostedUrl: "https://jobs.lever.co/acme-corp_br/m1",
          country: "BR",
        },
      ]),
    );

    expect(await fetchFeed(greenhouse, fetchImpl)).toEqual({
      jobs: [
        {
          sourceKey: "acme:7",
          title: "Analista",
          company: "Acme",
          workModel: null,
          city: null,
          state: null,
          url: "https://job-boards.greenhouse.io/acme/jobs/7",
          description: "",
          postedAt: null,
        },
      ],
      skipped: 0,
    });
    expect(await fetchFeed(lever, fetchImpl)).toEqual({
      jobs: [
        {
          sourceKey: "acme-corp_br:m1",
          title: "Analista",
          company: "Acme Corp Br",
          workModel: null,
          city: null,
          state: null,
          url: "https://jobs.lever.co/acme-corp_br/m1",
          description: "",
          postedAt: null,
        },
      ],
      skipped: 0,
    });
  });

  it("trusts a Brazilian Lever country for the location and accepts on-site", async () => {
    const { fetchImpl } = recordingFetch(
      json([
        leverPosting("c1", {
          workplaceType: "on-site",
          categories: { location: "Curitiba, PR", allLocations: [] },
        }),
        leverPosting("c2", {
          country: "US",
          categories: { location: "Curitiba, PR", allLocations: [] },
        }),
      ]),
    );

    const result = await fetchFeed(lever, fetchImpl);

    expect("jobs" in result && result.jobs).toEqual([
      expect.objectContaining({
        sourceKey: "acme-corp_br:c1",
        workModel: "onsite",
        city: "Curitiba",
        state: "PR",
      }),
    ]);
  });

  it("parses at most 1 000 characters of a location", async () => {
    const { fetchImpl } = recordingFetch(
      json({
        jobs: [
          greenhouseJob(1, { location: { name: `${"x".repeat(1_000)}, São Paulo` } }),
          greenhouseJob(2, { location: { name: `Recife - PE${" ".repeat(50_000)}- x` } }),
        ],
      }),
    );

    const result = await fetchFeed(greenhouse, fetchImpl);

    expect("jobs" in result && result.jobs.map((job) => [job.sourceKey, job.city])).toEqual([
      ["acme:2", "Recife"],
    ]);
  });

  it("skips invalid items", async () => {
    const { fetchImpl } = recordingFetch(
      json({
        jobs: [
          greenhouseJob(1),
          greenhouseJob(2, { title: undefined }),
          greenhouseJob(3, { title: "   " }),
          greenhouseJob(4, { absolute_url: "http://job-boards.greenhouse.io/acme/jobs/4" }),
          greenhouseJob(5, { absolute_url: "not a url" }),
          greenhouseJob(6, { id: "6" }),
          greenhouseJob(7, { title: "\u0000\u0000" }),
          null,
          "job",
          greenhouseJob(8, { location: { name: "New York, NY" } }),
          greenhouseJob(9),
        ],
      }),
      json([
        leverPosting("a1"),
        leverPosting("", {}),
        leverPosting("a3", { text: null }),
        leverPosting("a4", { hostedUrl: "ftp://jobs.lever.co/x" }),
        leverPosting("a5", { country: "US", categories: { location: "Austin, TX" } }),
      ]),
    );

    const greenhouseResult = await fetchFeed(greenhouse, fetchImpl);
    const leverResult = await fetchFeed(lever, fetchImpl);

    expect(greenhouseResult).toMatchObject({ skipped: 8 });
    expect("jobs" in greenhouseResult && greenhouseResult.jobs.map((job) => job.sourceKey)).toEqual(
      ["acme:1", "acme:9"],
    );
    expect(leverResult).toMatchObject({ skipped: 3 });
    expect("jobs" in leverResult && leverResult.jobs.map((job) => job.sourceKey)).toEqual([
      "acme-corp_br:a1",
    ]);
  });

  it("keeps only jobs located in Brazil", async () => {
    const { fetchImpl } = recordingFetch(
      json({
        jobs: [
          greenhouseJob(1, { location: { name: "São Paulo" } }),
          greenhouseJob(2, { location: { name: "New York, NY" } }),
          greenhouseJob(3, { location: { name: "Philadelphia, PA" } }),
          greenhouseJob(4, { location: null }),
          greenhouseJob(5, { location: { name: "Remoto - Brasil" } }),
        ],
      }),
    );

    const result = await fetchFeed(greenhouse, fetchImpl);

    expect("jobs" in result && result.jobs.map((job) => [job.sourceKey, job.state])).toEqual([
      ["acme:1", "SP"],
      ["acme:5", null],
    ]);
    expect(result).toMatchObject({ skipped: 0 });
  });

  it("detects the Greenhouse work model from the title and location", async () => {
    const { fetchImpl } = recordingFetch(
      json({
        jobs: [
          greenhouseJob(1, { title: "Engenheiro (Remoto)" }),
          greenhouseJob(2, { location: { name: "Híbrido - Rio de Janeiro, Brasil" } }),
          greenhouseJob(3, { title: "Analista" }),
        ],
      }),
    );

    const result = await fetchFeed(greenhouse, fetchImpl);

    expect("jobs" in result && result.jobs.map((job) => job.workModel)).toEqual([
      "remote",
      "hybrid",
      null,
    ]);
  });

  it("prefers the company label and falls back to the board name", async () => {
    const { fetchImpl } = recordingFetch(
      json({ jobs: [greenhouseJob(1)] }),
      json([leverPosting("a1")]),
      json({
        jobs: [greenhouseJob(2, { company_name: null }), greenhouseJob(3, { company_name: " " })],
      }),
    );

    const labelled = await fetchFeed({ ...greenhouse, companyLabel: "Acme" }, fetchImpl);
    const labelledLever = await fetchFeed({ ...lever, companyLabel: "Acme Brasil" }, fetchImpl);
    const unnamed = await fetchFeed(greenhouse, fetchImpl);

    expect("jobs" in labelled && labelled.jobs[0]?.company).toBe("Acme");
    expect("jobs" in labelledLever && labelledLever.jobs[0]?.company).toBe("Acme Brasil");
    expect("jobs" in unnamed && unnamed.jobs.map((job) => job.company)).toEqual(["Acme", "Acme"]);
  });

  it("cleans, unescapes and clips text fields", async () => {
    const { fetchImpl } = recordingFetch(
      json({
        jobs: [
          greenhouseJob(1, {
            title: ` ${"T".repeat(300)} `,
            company_name: "Acme\u0000 Pagamentos",
            content: `&lt;p&gt;${"x".repeat(25_000)}&lt;/p&gt;`,
            location: { name: `${"C".repeat(300)}, SP, Brasil` },
            first_published: "not a date",
          }),
          greenhouseJob(2, { content: null, first_published: null }),
        ],
      }),
      json([leverPosting("a1", { descriptionPlain: "y".repeat(25_000), createdAt: 9e15 })]),
    );

    const result = await fetchFeed(greenhouse, fetchImpl);
    const leverResult = await fetchFeed(lever, fetchImpl);

    expect(result).toMatchObject({
      jobs: [
        {
          title: "T".repeat(255),
          company: "Acme Pagamentos",
          city: "C".repeat(255),
          description: "x".repeat(20_000),
          postedAt: null,
        },
        { description: "", postedAt: null },
      ],
    });
    expect(leverResult).toMatchObject({
      jobs: [{ description: "y".repeat(20_000), postedAt: null }],
    });
  });

  it("reports a non-2xx response and cancels its body", async () => {
    let cancelled = false;

    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    const { fetchImpl } = recordingFetch(new Response(body, { status: 404 }));

    expect(await fetchFeed(greenhouse, fetchImpl)).toEqual({ error: "http_error", status: 404 });
    expect(cancelled).toBe(true);
  });

  it.each([
    ["garbage", "{not json"],
    ["a Greenhouse array", "[]"],
    ["jobs that are not a list", '{"jobs":{}}'],
  ])("rejects %s from Greenhouse as invalid json", async (_label, text) => {
    const { fetchImpl } = recordingFetch(new Response(text));

    expect(await fetchFeed(greenhouse, fetchImpl)).toEqual({ error: "invalid_json" });
  });

  it("rejects a Lever object or an empty body as invalid json", async () => {
    const { fetchImpl } = recordingFetch(json({ jobs: [] }), new Response(null));

    expect(await fetchFeed(lever, fetchImpl)).toEqual({ error: "invalid_json" });
    expect(await fetchFeed(lever, fetchImpl)).toEqual({ error: "invalid_json" });
  });

  it("reports a timed out or failed request as a timeout", async () => {
    const timedOut = async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };

    const refused = async () => {
      throw new TypeError("fetch failed");
    };

    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        controller.error(new DOMException("The operation timed out.", "TimeoutError"));
      },
    });

    const { fetchImpl } = recordingFetch(new Response(stalled));

    expect(await fetchFeed(greenhouse, timedOut)).toEqual({ error: "timeout" });
    expect(await fetchFeed(lever, refused)).toEqual({ error: "timeout" });
    expect(await fetchFeed(lever, fetchImpl)).toEqual({ error: "timeout" });
  });

  it("rejects a declared or streamed body over 10 MB", async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1_000_000).fill(0x20);

    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });

    const { fetchImpl } = recordingFetch(
      new Response("[]", { headers: { "content-length": "10000001" } }),
      new Response(endless),
      new Response(`[${" ".repeat(9_999_998)}]`),
    );

    expect(await fetchFeed(lever, fetchImpl)).toEqual({ error: "too_large" });
    expect(await fetchFeed(lever, fetchImpl)).toEqual({ error: "too_large" });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(15);
    expect(await fetchFeed(lever, fetchImpl)).toEqual({ jobs: [], skipped: 0 });
  });
});
