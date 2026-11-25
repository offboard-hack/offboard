import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import type { ProfileFields, ResumeContent } from "@offboard/db/schema";
import {
  aiApplications,
  applicationPackages,
  applications,
  jobRejections,
  jobs,
  llmUsage,
  offboardingCases,
  resumes,
  talentPreferences,
  talentProfiles,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Elysia } from "elysia";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";
import type { GenerateStructured } from "../../shared/ai.js";
import type { PortalAuth } from "../../shared/portal-auth.js";
import { talentAccess } from "../../shared/talent-access.js";
import { aiApplyRoutes } from "./routes.js";
import { readGreenhouseForm } from "./greenhouse.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const webOrigin = "http://localhost:5173";
const email = "ana.pessoal@example.com";
const stone = readFileSync(new URL("./fixtures/greenhouse-stone.json", import.meta.url), "utf8");

const auth: PortalAuth = {
  handler: async () => new Response(null),
  resolvePrincipal: (headers) =>
    Promise.resolve({
      kind: "talent",
      profile: {
        id: headers.get("x-test-talent-id") ?? "",
        name: "Test",
        email: "test@example.com",
      },
    }),
};

const resume: ResumeContent = {
  headline: { id: "h", text: "Engenheira de Software" },
  summary: { id: "s", text: "Dez anos de backend." },
  experiences: [
    {
      id: "e",
      company: "Acme",
      role: "Engenheira",
      start: "2019-03",
      end: null,
      bullets: [{ id: "b", text: "Liderou a migração" }],
    },
  ],
  education: [],
  skills: [{ id: "k", name: "TypeScript" }],
  languages: [],
  contact: {
    email: "ana@example.com",
    phone: "11 97777-6666",
    city: "Campinas",
    links: ["https://linkedin.com/in/ana-resume"],
  },
};

const address = {
  cep: "01310100",
  street: "Avenida Paulista",
  number: "1000",
  complement: null,
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
};

type ModelAnswer = {
  questionId: string;
  value: string | string[] | null;
  source: string | null;
  inferred: boolean;
};

type Setup = {
  takeLlmCall?: () => Promise<true | { retryAt: Date }>;
  allowlist?: string[];
  consent?: boolean;
  generate?: GenerateStructured | null;
  form?: () => Response | Promise<Response>;
};

describe.skipIf(!url)("ai apply route", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function profile(personalEmail = email, caseIndex = 0, consent = true) {
    const cases = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    const created = await repos.talent.enable({
      caseId: cases[caseIndex].id,
      personalEmail,
      sponsoredUntil: "2099-12-31",
    });

    if (
      created === "case_not_found" ||
      created === "already_enabled" ||
      created === "email_taken"
    ) {
      throw new Error(created);
    }

    await repos.talent.acceptTerms(created.id);

    if (consent) await repos.talent.setAiApplyConsent(created.id, true, new Date());

    await db
      .update(talentProfiles)
      .set({ name: "  Ana Maria  Souza " })
      .where(eq(talentProfiles.id, created.id));

    return created.id;
  }

  async function addResume(profileId: string) {
    const [row] = await db
      .insert(resumes)
      .values({ profileId, kind: "base", content: resume })
      .returning({ id: resumes.id });

    return row.id;
  }

  async function addJob(sourceKey = "stone:8201530003", source = "greenhouse", closedAt?: Date) {
    const [row] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source,
        sourceKey,
        title: "Account Executive",
        company: "Stone",
        url: `https://job-boards.greenhouse.io/${sourceKey}`,
        closedAt,
      })
      .returning({ id: jobs.id });

    return row.id;
  }

  function fakeModel(answers: (prompt: string) => ModelAnswer[] = () => []) {
    const calls: { system: string; prompt: string }[] = [];

    const generate: GenerateStructured = async ({ schema, system, prompt }) => {
      calls.push({ system, prompt });

      return schema.parse({ answers: answers(prompt) });
    };

    return { generate, calls };
  }

  function build(setup: Setup = {}) {
    const fetched: string[] = [];

    const respond = async (input: string | URL | Request) => {
      fetched.push(String(input));

      return (setup.form ?? (() => new Response(stone)))();
    };

    const instance = new Elysia().use(
      aiApplyRoutes(
        repos.aiApply,
        talentAccess({
          auth,
          webOrigin,
          talent: repos.talent,
          companyActive: async () => true,
        }),
        {
          allowlist: setup.allowlist ?? [email.toUpperCase()],
          generate: setup.generate === null ? undefined : setup.generate,
          takeLlmCall: setup.takeLlmCall ?? repos.llmUsage.takeLlmCall,
          readForm: (board, posting) => readGreenhouseForm(respond, board, posting),
          library: async (profileId) =>
            (await repos.answers.library(profileId)).questions.flatMap((item) =>
              item.answer === null
                ? []
                : [{ question: item.text, answer: item.answer, sensitive: item.sensitive }],
            ),
        },
      ),
    );

    const post = (profileId: string, jobId: string) =>
      instance.handle(
        new Request(`http://localhost/me/jobs/${jobId}/ai-apply`, {
          method: "POST",
          headers: { "x-test-talent-id": profileId, origin: webOrigin },
        }),
      );

    return { post, fetched };
  }

  const attempts = (profileId: string) =>
    db.select().from(aiApplications).where(eq(aiApplications.profileId, profileId));

  const usage = (profileId: string) =>
    db.select({ calls: llmUsage.calls }).from(llmUsage).where(eq(llmUsage.profileId, profileId));

  async function ready(setup: Setup = {}) {
    const model = fakeModel();
    const profileId = await profile();
    const resumeId = await addResume(profileId);
    const jobId = await addJob();
    const app = build({ generate: model.generate, ...setup });

    return { ...app, model, profileId, resumeId, jobId };
  }

  const questionOf = (
    body: { attempt: { questions: { id: string; label: string }[] } },
    start: string,
  ) => {
    const found = body.attempt.questions.find((item) => item.label.startsWith(start));

    if (!found) throw new Error(start);

    return found;
  };

  const answerFor = (body: { attempt: { answers: { questionId: string }[] } }, id: string) =>
    body.attempt.answers.find((item) => item.questionId === id);

  describe("gate", () => {
    it("refuses people who are not allowlisted or have not consented, and AI that is off", async () => {
      const profileId = await profile();
      const jobId = await addJob();

      const denied = build({ allowlist: ["outra@example.com"], generate: fakeModel().generate });
      const unlisted = await denied.post(profileId, jobId);

      expect(unlisted.status).toBe(403);
      expect(await unlisted.json()).toEqual({ error: "AI Apply not available" });

      await repos.talent.setAiApplyConsent(profileId, false, new Date());

      const open = build({ generate: fakeModel().generate });
      const unconsented = await open.post(profileId, jobId);

      expect(unconsented.status).toBe(403);
      expect(await unconsented.json()).toEqual({ error: "AI Apply not available" });

      await repos.talent.setAiApplyConsent(profileId, true, new Date());

      const off = build({ generate: null });
      const unavailable = await off.post(profileId, jobId);

      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ error: "AI not configured" });
      expect([denied.fetched, open.fetched, off.fetched]).toEqual([[], [], []]);
      expect(await attempts(profileId)).toEqual([]);
    });
  });

  describe("preconditions", () => {
    it("rejects jobs that can't be AI-applied", async () => {
      const { post, fetched, profileId, jobId } = await ready();

      const missing = "00000000-0000-4000-8000-000000000001";

      const unusable = [
        await addJob("stone:1", "lever"),
        await addJob("stone:2", "greenhouse", new Date()),
        await addJob("Stone:3"),
        await addJob("stone-without-id"),
        await addJob("stone:abc"),
        missing,
        "not-a-uuid",
      ];

      for (const id of unusable) {
        const res = await post(profileId, id);

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "Job not found" });
      }

      expect(fetched).toEqual([]);
      expect(await attempts(profileId)).toEqual([]);
      expect((await post(profileId, jobId)).status).toBe(201);
    });

    it("answers each precondition with its own conflict, before reading the form", async () => {
      const model = fakeModel();
      const app = build({ generate: model.generate });
      const profileId = await profile();
      const jobId = await addJob();

      const conflict = async (expected: string) => {
        const res = await app.post(profileId, jobId);

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: expected });
      };

      await conflict("Upload a résumé first");

      const resumeId = await addResume(profileId);

      await db.insert(applications).values({ profileId, jobId, resumeId });
      await conflict("Already applied");

      await db.delete(applications);
      await db.insert(jobRejections).values({ profileId, jobId, reason: "other" });
      await conflict("Job rejected");

      await db.delete(jobRejections);
      await db.insert(aiApplications).values({
        profileId,
        jobId,
        state: "needs_check",
        form: { questions: [] },
        draft: [],
        preparedAt: new Date(),
      });
      await conflict("Already in progress");

      expect(app.fetched).toEqual([]);
      expect(model.calls).toEqual([]);
      expect(await usage(profileId)).toEqual([]);
    });

    it("allows a new attempt after a final one", async () => {
      const { post, profileId, jobId, resumeId } = await ready();

      await db.insert(aiApplications).values({
        profileId,
        jobId,
        state: "cancelled",
        form: { questions: [] },
        draft: [],
        preparedAt: new Date(),
      });

      const res = await post(profileId, jobId);

      expect(res.status).toBe(201);
      const rows = await attempts(profileId);

      expect(rows.find((row) => row.state === "draft")?.resumeId).toBe(resumeId);
      expect(rows.map((row) => row.state).sort()).toEqual(["cancelled", "draft"]);
    });
  });

  describe("forms", () => {
    it("handles unreadable forms", async () => {
      const cases: [() => Response | Promise<Response>, number, string][] = [
        [() => new Response("nope", { status: 404 }), 404, "Job not found"],
        [() => new Response("down", { status: 500 }), 502, "Could not read the application form"],
        [() => new Response("<html>Hi</html>"), 502, "Could not read the application form"],
        [() => new Response('{"questions": ['), 502, "Could not read the application form"],
        [() => new Response("{}"), 502, "Could not read the application form"],
        [() => Promise.reject(new Error("network")), 502, "Could not read the application form"],
      ];

      const profileId = await profile();

      await addResume(profileId);

      const jobId = await addJob();
      const model = fakeModel();

      for (const [form, expected, message] of cases) {
        const { post } = build({ generate: model.generate, form });

        const res = await post(profileId, jobId);

        expect(res.status).toBe(expected);
        expect(await res.json()).toEqual({ error: message });
        expect(await attempts(profileId)).toEqual([]);
        expect(await usage(profileId)).toEqual([]);
        expect(model.calls).toEqual([]);
      }
    });

    it("reads the board and posting from the job source key", async () => {
      const { post, fetched, profileId, jobId } = await ready();

      await post(profileId, jobId);

      expect(fetched).toEqual([
        "https://boards-api.greenhouse.io/v1/boards/stone/jobs/8201530003?questions=true",
      ]);
    });
  });

  describe("drafting", () => {
    it("prepares a draft for a Greenhouse job", async () => {
      const model = fakeModel((prompt) => {
        const asked: { questionId: string; label: string }[] = JSON.parse(
          prompt.slice(prompt.indexOf("<questions>") + 11, prompt.indexOf("</questions>")),
        );

        const hybrid = asked.find((item) => item.label.startsWith("Você tem disponibilidade"));

        return hybrid
          ? [{ questionId: hybrid.questionId, value: "Yes", source: null, inferred: true }]
          : [];
      });

      const profileId = await profile();
      const resumeId = await addResume(profileId);
      const jobId = await addJob();
      const app = build({ generate: model.generate });

      await db.insert(talentPreferences).values({
        profileId,
        profileFields: {
          phone: { value: "11 98888-7777", share: true },
          linkedin: { value: "linkedin.com/in/ana", share: true },
          cpf: { value: "52998224725", share: true },
          address: { value: address, share: true },
        } satisfies ProfileFields,
      });

      await db.insert(applicationPackages).values({ profileId, jobId, coverLetter: "Olá, Stone." });

      const before = Date.now();
      const res = await app.post(profileId, jobId);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.attempt).toMatchObject({
        job: { id: jobId, title: "Account Executive", company: "Stone" },
        state: "draft",
        reason: null,
        rehearsal: false,
        confirmedAt: null,
      });
      expect(Date.parse(body.attempt.preparedAt)).toBeGreaterThanOrEqual(before);

      const text = (id: string) => answerFor(body, id);

      expect(text("first_name")).toMatchObject({
        value: "Ana",
        source: "account",
        status: "filled",
      });
      expect(text("last_name")).toMatchObject({ value: "Maria Souza", status: "filled" });
      expect(text("email")).toMatchObject({ value: email, status: "filled" });
      expect(text("phone")).toMatchObject({ value: "11 98888-7777", source: "profile" });
      expect(text("resume")).toMatchObject({ value: null, source: "resume", status: "filled" });
      expect(text("cover_letter")).toMatchObject({ source: "cover_letter", status: "filled" });

      const cpf = questionOf(body, "Qual é o seu CPF");

      expect(text(cpf.id)).toMatchObject({ value: "529.982.247-25", source: "profile" });

      const home = questionOf(body, "Qual é o seu endereço");

      expect(text(home.id)).toMatchObject({
        value: "Avenida Paulista, 1000 - Bela Vista, São Paulo - SP, CEP 01310-100",
      });

      const linkedin = questionOf(body, "Qual é o seu perfil do Linkedin");

      expect(text(linkedin.id)).toMatchObject({ value: "linkedin.com/in/ana" });

      const hybrid = questionOf(body, "Você tem disponibilidade");

      expect(text(hybrid.id)).toMatchObject({ value: "1", inferred: true, status: "filled" });

      const salary = questionOf(body, "Qual é a sua pretensão salarial");

      expect(text(salary.id)).toMatchObject({ value: null, status: "not_shared" });

      const rows = await attempts(profileId);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: body.attempt.id,
        state: "draft",
        reason: null,
        resumeId,
        confirmed: null,
        confirmedAt: null,
        rehearsal: false,
      });
      expect(rows[0].form.questions).toEqual(body.attempt.questions);
      expect(rows[0].draft).toEqual(body.attempt.answers);
      expect(rows[0].preparedAt.toISOString()).toBe(body.attempt.preparedAt);
      expect(await usage(profileId)).toEqual([{ calls: 1 }]);
      expect(model.calls).toHaveLength(1);
    });

    it("reuses library answers before calling the model", async () => {
      const { post, model, profileId, jobId } = await ready();

      const ids = await repos.answers.ensureQuestion(
        "Você é indicação de alguma pessoa que trabalha com a gente?",
        new Date(),
      );

      await repos.answers.answer(profileId, ids, "No", new Date());

      const res = await post(profileId, jobId);
      const body = await res.json();

      const referral = questionOf(body, "Você é indicação");

      expect(answerFor(body, referral.id)).toMatchObject({
        value: "0",
        source: "library",
        inferred: false,
      });
      expect(model.calls[0].prompt).not.toContain(referral.id);
    });

    it("keeps not-shared data out of the draft and the prompt", async () => {
      const { post, model, profileId, jobId } = await ready();

      await db.insert(talentPreferences).values({
        profileId,
        profileFields: {
          phone: { value: "11 90000-0000", share: false },
          cpf: { value: "52998224725", share: false },
          salaryExpectation: { value: "R$ 9.000", share: false },
          city: { value: "Oculta", share: false },
          address: { value: address, share: false },
        } satisfies ProfileFields,
      });

      const salaryQuestion = await repos.answers.ensureQuestion(
        "Qual a sua pretensão salarial?",
        new Date(),
      );

      await repos.answers.answer(profileId, salaryQuestion, "R$ 12.345 por mês", new Date());

      const res = await post(profileId, jobId);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(answerFor(body, "phone")).toMatchObject({ value: null, status: "not_shared" });
      expect(answerFor(body, questionOf(body, "Qual é o seu CPF").id)).toMatchObject({
        value: null,
        status: "not_shared",
      });
      expect(answerFor(body, questionOf(body, "Qual é a sua pretensão salarial").id)).toMatchObject(
        {
          value: null,
          status: "not_shared",
        },
      );

      const seen = JSON.stringify(body) + model.calls.map((item) => item.prompt).join("\n");

      for (const secret of [
        "11 90000-0000",
        "52998",
        "529.982",
        "R$ 9.000",
        "12.345",
        "Oculta",
        "Paulista",
        "97777",
        "Campinas",
        "ana-resume",
      ]) {
        expect(seen).not.toContain(secret);
      }

      expect(JSON.stringify((await attempts(profileId))[0])).not.toMatch(
        /11 90000|52998|12\.345|Paulista/,
      );
    });

    it("never infers sensitive questions", async () => {
      const model = fakeModel((prompt) => {
        const asked: { questionId: string }[] = JSON.parse(
          prompt.slice(prompt.indexOf("<questions>") + 11, prompt.indexOf("</questions>")),
        );

        return asked.map((item) => ({
          questionId: item.questionId,
          value: "1",
          source: null,
          inferred: true,
        }));
      });

      const { post, profileId, jobId } = await ready({ generate: model.generate });

      const first = await (await post(profileId, jobId)).json();
      const pcd = questionOf(first, "Você é uma pessoa com deficiência");
      const consent = questionOf(first, "Consentimento");

      expect(answerFor(first, pcd.id)).toEqual({
        questionId: pcd.id,
        value: null,
        source: null,
        inferred: false,
        status: "sensitive",
      });
      expect(answerFor(first, consent.id)).toMatchObject({ value: null, status: "sensitive" });
      expect(model.calls[0].prompt).not.toContain(pcd.id);
      expect(model.calls[0].prompt).not.toContain("deficiência");
      expect(model.calls[0].prompt).not.toContain("Consentimento");

      await db.delete(aiApplications);

      const saved = await repos.answers.ensureQuestion(
        "Você é uma pessoa com deficiência?",
        new Date(),
      );

      await repos.answers.answer(profileId, saved, "No", new Date());

      const second = await (await post(profileId, jobId)).json();

      expect(answerFor(second, pcd.id)).toMatchObject({
        value: "0",
        source: "library",
        status: "filled",
        inferred: false,
      });
      expect(model.calls[1].prompt).not.toContain("deficiência");
    });

    it("matches select answers to options or drafts them blank", async () => {
      const answers: ModelAnswer[] = [];

      const model = fakeModel((prompt) => {
        const asked: { questionId: string; label: string }[] = JSON.parse(
          prompt.slice(prompt.indexOf("<questions>") + 11, prompt.indexOf("</questions>")),
        );

        const find = (start: string) =>
          asked.find((item) => item.label.startsWith(start))?.questionId ?? "";

        answers.push(
          {
            questionId: find("Você tem disponibilidade"),
            value: "  YES ",
            source: null,
            inferred: true,
          },
          { questionId: find("Você é indicação"), value: "Talvez", source: null, inferred: true },
          {
            questionId: find("Como você conheceu"),
            value: ["amigos, colegas ou familiares", "Inexistente"],
            source: null,
            inferred: true,
          },
          {
            questionId: find("Qual motivo"),
            value: ["Autonomia"],
            source: "resume",
            inferred: true,
          },
          { questionId: "unknown", value: "x", source: null, inferred: true },
        );

        return answers;
      });

      const { post, profileId, jobId } = await ready({ generate: model.generate });

      const body = await (await post(profileId, jobId)).json();

      const value = (start: string) => answerFor(body, questionOf(body, start).id);

      expect(value("Você tem disponibilidade")).toMatchObject({ value: "1", status: "filled" });
      expect(value("Você é indicação")).toMatchObject({ value: null, status: "blank" });
      expect(value("Como você conheceu")).toMatchObject({ value: null, status: "blank" });
      expect(value("Qual motivo")).toMatchObject({ value: [expect.any(String)], status: "filled" });
      expect(body.attempt.answers).toHaveLength(body.attempt.questions.length);
    });

    it("skips the model and the cap when every question is deterministic", async () => {
      const body = JSON.stringify({
        questions: [
          {
            label: "Nome",
            required: true,
            fields: [{ name: "first_name", type: "input_text", values: [] }],
          },
          {
            label: "Currículo",
            required: true,
            fields: [{ name: "resume", type: "input_file", values: [] }],
          },
        ],
      });

      const { post, model, profileId, jobId } = await ready({ form: () => new Response(body) });

      const res = await post(profileId, jobId);

      expect(res.status).toBe(201);
      expect(model.calls).toEqual([]);
      expect(await usage(profileId)).toEqual([]);
    });
  });

  describe("document uploads", () => {
    const withDocument = (required: boolean) => {
      const job = JSON.parse(stone);

      job.questions.push({
        label: "Laudo médico",
        required,
        fields: [{ name: "question_laudo", type: "input_file", values: [] }],
      });

      return JSON.stringify(job);
    };

    it("creates an assisted attempt when a document is required", async () => {
      const { post, model, profileId, jobId, resumeId } = await ready({
        form: () => new Response(withDocument(true)),
      });

      const res = await post(profileId, jobId);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.attempt).toMatchObject({
        state: "assisted",
        reason: "document_required",
        answers: [],
      });
      expect(
        body.attempt.questions.some((item: { label: string }) => item.label === "Laudo médico"),
      ).toBe(true);
      expect(model.calls).toEqual([]);
      expect(await usage(profileId)).toEqual([]);
      expect(
        (await attempts(profileId)).map((row) => [row.state, row.reason, row.resumeId]),
      ).toEqual([["assisted", "document_required", resumeId]]);
    });

    it("treats a required Portfólio or address-proof upload as a document", async () => {
      const upload = (label: string, name: string) =>
        JSON.stringify({
          questions: [
            { label, required: true, fields: [{ name, type: "input_file", values: [] }] },
          ],
        });

      const { model, profileId, jobId } = await ready();

      for (const [label, name] of [
        ["Portfólio", "question_1"],
        ["Comprovante de endereço", "question_2"],
      ]) {
        const { post } = build({
          generate: model.generate,
          form: () => new Response(upload(label, name)),
        });

        const body = await (await post(profileId, jobId)).json();

        expect(body.attempt).toMatchObject({ state: "assisted", reason: "document_required" });

        await db.delete(aiApplications);
      }

      expect(model.calls).toEqual([]);
    });

    it("returns the existing assisted attempt without reading the form again", async () => {
      const { post, fetched, profileId, jobId } = await ready({
        form: () => new Response(withDocument(true)),
      });

      const first = await (await post(profileId, jobId)).json();
      const res = await post(profileId, jobId);

      expect(res.status).toBe(200);
      expect((await res.json()).attempt).toEqual(first.attempt);
      expect(fetched).toHaveLength(1);
      expect(await attempts(profileId)).toHaveLength(1);
    });

    it("drafts normally when the document is optional", async () => {
      const { post, profileId, jobId } = await ready({
        form: () => new Response(withDocument(false)),
      });

      const body = await (await post(profileId, jobId)).json();

      expect(body.attempt.state).toBe("draft");
      expect(answerFor(body, "question_laudo")).toMatchObject({ value: null, status: "blank" });
    });
  });

  describe("limits and failures", () => {
    it("answers 429 without a row when the daily cap is used up", async () => {
      const { post, model, profileId, jobId } = await ready();

      await db.insert(llmUsage).values({
        profileId,
        day: new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date()),
        calls: 30,
      });

      const res = await post(profileId, jobId);

      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: "Daily AI limit reached" });
      expect(model.calls).toEqual([]);
      expect(await attempts(profileId)).toEqual([]);
    });

    it("lets a usage lookup failure surface as a server error", async () => {
      const { post, profileId, jobId } = await ready({
        takeLlmCall: async () => {
          throw new Error("db down");
        },
      });

      const res = await post(profileId, jobId);

      expect(res.status).toBe(500);
      expect(await attempts(profileId)).toEqual([]);
    });

    it("answers 502 without a row when the model fails", async () => {
      const failing: GenerateStructured = async () => {
        throw new Error("gateway down");
      };

      const { post, profileId, jobId } = await ready({ generate: failing });

      const res = await post(profileId, jobId);

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "Could not prepare the application" });
      expect(await attempts(profileId)).toEqual([]);
    });

    it("answers 409 when another attempt starts while the form is being read", async () => {
      const profileId = await profile();

      await addResume(profileId);

      const jobId = await addJob();

      const { post } = build({
        generate: fakeModel().generate,
        form: async () => {
          await db.insert(aiApplications).values({
            profileId,
            jobId,
            state: "draft",
            form: { questions: [] },
            draft: [],
            preparedAt: new Date(),
          });

          return new Response(stone);
        },
      });

      const res = await post(profileId, jobId);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Already in progress" });
      expect(await attempts(profileId)).toHaveLength(1);
    });
  });
});
