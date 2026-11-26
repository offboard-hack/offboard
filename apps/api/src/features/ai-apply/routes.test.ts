import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import type { FormQuestion, ProfileFields, ResumeContent } from "@offboard/db/schema";
import { normalizeQuestion } from "@offboard/db/question";
import {
  aiApplications,
  answerQuestions,
  backgroundJobs,
  applicationEvents,
  applicationPackages,
  applications,
  defaultOrgId,
  jobRejections,
  jobs,
  llmUsage,
  offboardingCases,
  resumes,
  talentAnswers,
  talentPreferences,
  talentProfiles,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Elysia } from "elysia";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositories } from "../../repositories.js";
import type { GenerateStructured } from "../../shared/ai.js";
import type { ObjectStorage } from "../../shared/object-storage.js";
import type { PortalAuth } from "../../shared/portal-auth.js";
import { talentAccess } from "../../shared/talent-access.js";
import type { SaveAnswer } from "./repository.js";
import { aiApplyRoutes } from "./routes.js";
import { readGreenhouseForm } from "./greenhouse.js";
import type { Page } from "./browser/cdp.js";
import { runAiApplication, type RunnerDeps } from "./runner.js";

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

type Body = {
  answers: { questionId: string; value: string | string[] | null }[];
  rehearsal?: boolean;
};

type Setup = {
  takeLlmCall?: () => Promise<true | { retryAt: Date }>;
  allowlist?: string[];
  consent?: boolean;
  generate?: GenerateStructured | null;
  runnerConfigured?: boolean;
  form?: () => Response | Promise<Response>;
  saveAnswer?: SaveAnswer;
  enqueueRun?: (attemptId: string) => Promise<void>;
  runNow?: (attemptId: string) => Promise<boolean>;
  storage?: ObjectStorage;
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
      orgId: defaultOrgId,
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

  const saveToLibrary: SaveAnswer = async (tx, profileId, label, text, { sensitive }, now) => {
    const [saved] = await tx
      .insert(answerQuestions)
      .values({ normalized: normalizeQuestion(label), text: label, sensitive, createdAt: now })
      .onConflictDoUpdate({
        target: answerQuestions.normalized,
        set: { sensitive: sql`${answerQuestions.sensitive} or ${sensitive}` },
      })
      .returning({ id: answerQuestions.id });

    await tx
      .insert(talentAnswers)
      .values({ profileId, questionId: saved.id, answer: text, updatedAt: now })
      .onConflictDoUpdate({
        target: [talentAnswers.profileId, talentAnswers.questionId],
        set: { answer: text, updatedAt: now },
      });
  };

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
          runnerConfigured: setup.runnerConfigured ?? true,
          takeLlmCall: setup.takeLlmCall ?? repos.llmUsage.takeLlmCall,
          readForm: (board, posting) => readGreenhouseForm(respond, board, posting),
          library: async (profileId) =>
            (await repos.answers.library(profileId)).questions.flatMap((item) =>
              item.answer === null
                ? []
                : [{ question: item.text, answer: item.answer, sensitive: item.sensitive }],
            ),
          saveAnswer: setup.saveAnswer ?? saveToLibrary,
          enqueueRun:
            setup.enqueueRun ?? ((attemptId) => repos.background.enqueue("ai_apply", attemptId)),
          runNow: setup.runNow ?? (async () => false),
          storage: setup.storage,
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

    const call = (
      profileId: string,
      path: string,
      body?: Body | { sent?: boolean | string },
      method = "POST",
    ) =>
      instance.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: {
            "x-test-talent-id": profileId,
            origin: webOrigin,
            "content-type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );

    return { post, fetched, call };
  }

  const memoryStorage = (objects: Record<string, Uint8Array>) => {
    const reads: string[] = [];

    const storage: ObjectStorage = {
      put: async () => undefined,
      remove: async () => undefined,
      removePrefix: async () => undefined,
      get: async (key) => {
        reads.push(key);

        return Object.hasOwn(objects, key) ? objects[key] : null;
      },
    };

    return { storage, reads };
  };

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

  describe("attempts", () => {
    const question = (id: string, partial: Partial<FormQuestion> = {}) =>
      ({
        id,
        label: id,
        required: false,
        section: "questions",
        fields: [{ name: id, type: "text", options: [] }],
        kind: "custom",
        sensitive: false,
        ...partial,
      }) satisfies FormQuestion;

    const choice = (id: string, type: "single_select" | "multi_select", labels: string[]) =>
      question(id, {
        fields: [
          {
            name: id,
            type,
            options: labels.map((label, index) => ({ label, value: String(index) })),
          },
        ],
      });

    const why = question("why", { label: "Por que a Stone?", required: true });

    const pcd = {
      ...choice("pcd", "single_select", ["Yes", "No"]),
      label: "Você é uma pessoa com deficiência?",
      required: true,
      sensitive: true,
    };

    const source = {
      ...choice("source", "multi_select", ["LinkedIn", "Indicação", "Site"]),
      label: "Como conheceu a Stone?",
    };

    const mail = question("email", { label: "E-mail", required: true, kind: "email" });
    const cv = question("resume", { label: "CV", required: true, kind: "resume", fields: [] });

    const letter = question("cover_letter", {
      label: "Carta",
      required: true,
      kind: "cover_letter",
      fields: [],
    });

    async function seed(
      profileId: string,
      jobId: string,
      questions: FormQuestion[],
      extra: Partial<typeof aiApplications.$inferInsert> = {},
    ) {
      const [row] = await db
        .insert(aiApplications)
        .values({
          profileId,
          jobId,
          state: "draft",
          form: { questions },
          draft: [],
          preparedAt: new Date(),
          ...extra,
        })
        .returning({ id: aiApplications.id });

      return row.id;
    }

    const confirmPath = (id: string) => `/me/ai-applications/${id}/confirm`;
    const cancelPath = (id: string) => `/me/ai-applications/${id}/cancel`;
    const checkPath = (id: string) => `/me/ai-applications/${id}/check`;
    const runPath = (id: string) => `/me/ai-applications/${id}/run`;
    const shotPath = (id: string) => `/me/ai-applications/${id}/screenshot`;

    const complete = [
      { questionId: "why", value: "  Gosto de fintechs. " },
      { questionId: "pcd", value: "1" },
      { questionId: "source", value: ["0", "2", "0"] },
      { questionId: "email", value: "ana@example.com" },
    ];

    async function setup(questions = [why, pcd, source, mail, cv], setupOptions: Setup = {}) {
      const app = await ready(setupOptions);
      const id = await seed(app.profileId, app.jobId, questions);

      return { ...app, id };
    }

    const library = async (profileId: string) =>
      (await repos.answers.library(profileId)).questions.filter((item) => item.answer !== null);

    it("lists newest first and returns one attempt, only to its owner", async () => {
      const { call, profileId, jobId } = await ready();
      const otherId = await profile("outra@example.com", 1);
      const otherJob = await addJob("stone:2");
      const older = await seed(profileId, jobId, [why], { state: "cancelled" });
      const newer = await seed(profileId, otherJob, [why]);
      const foreign = await seed(otherId, jobId, [why]);

      await db
        .update(aiApplications)
        .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
        .where(eq(aiApplications.id, older));

      const listed = await call(profileId, "/me/ai-applications", undefined, "GET");
      const body = await listed.json();

      expect(listed.status).toBe(200);
      expect(body.items.map((item: { id: string }) => item.id)).toEqual([newer, older]);
      expect(body.items[1]).toMatchObject({ state: "cancelled", questions: [why] });

      const one = await call(profileId, `/me/ai-applications/${newer}`, undefined, "GET");

      expect(one.status).toBe(200);
      expect(await one.json()).toMatchObject({ id: newer, job: { id: otherJob } });

      for (const id of [foreign, "not-a-uuid", "00000000-0000-4000-8000-000000000001"]) {
        const missing = await call(profileId, `/me/ai-applications/${id}`, undefined, "GET");

        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: "Attempt not found" });

        const confirmed = await call(profileId, confirmPath(id), { answers: [] });

        expect(confirmed.status).toBe(404);
        expect(await confirmed.json()).toEqual({ error: "Attempt not found" });

        const cancelled = await call(profileId, cancelPath(id));

        expect(cancelled.status).toBe(404);
        expect(await cancelled.json()).toEqual({ error: "Attempt not found" });

        const ran = await call(profileId, runPath(id));

        expect(ran.status).toBe(404);
        expect(await ran.json()).toEqual({ error: "Attempt not found" });
      }

      expect(
        (await db.select().from(aiApplications).where(eq(aiApplications.id, foreign)))[0],
      ).toMatchObject({ state: "draft" });
    });

    it("applies the gate to preparing, confirming and running only", async () => {
      const { profileId, jobId } = await ready();
      const id = await seed(profileId, jobId, [why]);

      const routes: [string, string, Body?][] = [
        ["POST", confirmPath(id), { answers: [{ questionId: "why", value: "x" }] }],
        ["POST", runPath(id)],
      ];

      const unlisted = build({ allowlist: [], generate: fakeModel().generate });
      const off = build({ generate: null });

      for (const [method, path, body] of routes) {
        const denied = await unlisted.call(profileId, path, body, method);

        expect(denied.status).toBe(403);
        expect(await denied.json()).toEqual({ error: "AI Apply not available" });

        const unavailable = await off.call(profileId, path, body, method);

        expect(unavailable.status).toBe(503);
        expect(await unavailable.json()).toEqual({ error: "AI not configured" });
      }

      expect((await attempts(profileId))[0]).toMatchObject({ state: "draft", confirmed: null });
    });

    it("lets a person without access still read and cancel their attempts", async () => {
      const profileId = await profile();
      const jobId = await addJob();
      const evidence = { fields: [], files: ["curriculo.pdf"], finalUrl: null };
      const shot = `ai-applications/${profileId}/shot.png`;
      const files = memoryStorage({ [shot]: new Uint8Array([1, 2]) });

      const id = await seed(profileId, jobId, [why], {
        state: "assisted",
        evidence,
        screenshotKey: shot,
      });

      await repos.talent.setAiApplyConsent(profileId, false, new Date());

      const closed = build({ allowlist: [], generate: null, storage: files.storage });

      const listed = await closed.call(profileId, "/me/ai-applications", undefined, "GET");

      expect(listed.status).toBe(200);
      expect((await listed.json()).items[0]).toMatchObject({ id, evidence, hasScreenshot: true });

      const one = await closed.call(profileId, `/me/ai-applications/${id}`, undefined, "GET");

      expect(one.status).toBe(200);
      expect(await one.json()).toMatchObject({ evidence, hasScreenshot: true });

      const image = await closed.call(profileId, shotPath(id), undefined, "GET");

      expect(image.status).toBe(200);
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2]));

      const draft = await seed(profileId, await addJob("stone:9"), [why]);

      expect((await closed.call(profileId, cancelPath(draft))).status).toBe(200);
    });

    it("refuses to confirm when Browserbase is not configured", async () => {
      const { call, profileId, id } = await setup();
      const body = { answers: [{ questionId: "why", value: "x" }] };

      const bare = build({ generate: fakeModel().generate, runnerConfigured: false });
      const refused = await bare.call(profileId, confirmPath(id), body);

      expect(refused.status).toBe(503);
      expect(await refused.json()).toEqual({ error: "AI Apply not configured" });

      const idle = await bare.call(profileId, runPath(id));

      expect(idle.status).toBe(503);
      expect(await idle.json()).toEqual({ error: "AI Apply not configured" });
      expect((await attempts(profileId))[0]).toMatchObject({ state: "draft", confirmed: null });
      expect((await call(profileId, `/me/ai-applications/${id}`, undefined, "GET")).status).toBe(
        200,
      );
    });

    it("confirms once", async () => {
      const { call, profileId, id } = await setup();

      const results = await Promise.all([
        call(profileId, confirmPath(id), { answers: complete }),
        call(profileId, confirmPath(id), { answers: complete }),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);

      const loser = results.find((res) => res.status === 409);

      expect(await loser?.json()).toEqual({ error: "Already in progress" });

      const rows = await attempts(profileId);

      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe("queued");

      const again = await call(profileId, confirmPath(id), { answers: complete });

      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: "Already in progress" });
    });

    it("enqueues the run once the confirm is stored", async () => {
      const { call, profileId, id } = await setup();

      expect(await db.select().from(backgroundJobs)).toEqual([]);

      const res = await call(profileId, confirmPath(id), { answers: complete });

      expect(res.status).toBe(200);
      expect(
        (await db.select().from(backgroundJobs)).map((job) => [job.kind, job.subject, job.status]),
      ).toEqual([["ai_apply", id, "pending"]]);
    });

    it("confirms even when the run cannot be enqueued", async () => {
      const logged = vi.spyOn(console, "error");

      const { call, profileId, id } = await setup(undefined, {
        enqueueRun: async () => {
          throw new Error("queue down");
        },
      });

      const res = await call(profileId, confirmPath(id), { answers: complete });

      expect(res.status).toBe(200);
      expect((await attempts(profileId))[0].state).toBe("queued");
      expect(logged).toHaveBeenCalledWith("AI application enqueue failed", {
        name: "Error",
        message: "queue down",
      });
      logged.mockRestore();
    });

    it("queues the attempt with the cleaned answers", async () => {
      const { call, profileId, id } = await setup();
      const before = Date.now();

      const res = await call(profileId, confirmPath(id), { answers: complete, rehearsal: true });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ id, state: "queued", reason: null, rehearsal: true });
      expect(body.confirmed).toEqual([
        { questionId: "why", value: "Gosto de fintechs." },
        { questionId: "pcd", value: "1" },
        { questionId: "source", value: ["0", "2"] },
        { questionId: "email", value: "ana@example.com" },
      ]);

      const fetched = await call(profileId, `/me/ai-applications/${id}`, undefined, "GET");

      expect((await fetched.json()).confirmed).toEqual(body.confirmed);
      expect(Date.parse(body.confirmedAt)).toBeGreaterThanOrEqual(before);

      const [row] = await attempts(profileId);

      expect(row.state).toBe("queued");
      expect(row.rehearsal).toBe(true);
      expect(row.confirmedAt?.toISOString()).toBe(body.confirmedAt);
      expect(row.confirmed).toEqual([
        { questionId: "why", value: "Gosto de fintechs." },
        { questionId: "pcd", value: "1" },
        { questionId: "source", value: ["0", "2"] },
        { questionId: "email", value: "ana@example.com" },
      ]);

      const lax = await seed(profileId, await addJob("stone:10"), [
        { ...why, required: false },
        { ...source },
      ]);

      const blank = await call(profileId, confirmPath(lax), {
        answers: [
          { questionId: "why", value: "   " },
          { questionId: "source", value: [] },
        ],
      });

      expect(blank.status).toBe(200);
      expect(
        (await db.select().from(aiApplications).where(eq(aiApplications.id, lax)))[0].confirmed,
      ).toEqual([
        { questionId: "why", value: null },
        { questionId: "source", value: null },
      ]);
    });

    it("saves confirmed answers to the library", async () => {
      const profileId = await profile();
      await addResume(profileId);

      const [stoneJob, otherJob] = [await addJob(), await addJob("stone:77")];

      const phone = question("phone", {
        label: "Telefone",
        kind: "phone",
        sensitive: false,
      });

      const bare = question("bare", { label: "Algo opcional" });
      const symbols = question("symbols", { label: "???" });
      const long = question("long", { label: "x".repeat(600) });

      const model = fakeModel();
      const app = build({ generate: model.generate });

      const id = await seed(profileId, stoneJob, [
        why,
        pcd,
        source,
        mail,
        phone,
        bare,
        symbols,
        long,
      ]);

      const res = await app.call(profileId, confirmPath(id), {
        answers: [
          ...complete,
          { questionId: "phone", value: "11 91111-2222" },
          { questionId: "bare", value: null },
          { questionId: "symbols", value: "sem rótulo" },
          { questionId: "long", value: "resposta longa" },
        ],
      });

      expect(res.status).toBe(200);

      const saved = await library(profileId);

      expect(saved.map(({ text, answer, sensitive }) => ({ text, answer, sensitive }))).toEqual(
        expect.arrayContaining([
          { text: "Por que a Stone?", answer: "Gosto de fintechs.", sensitive: false },
          { text: pcd.label, answer: "No", sensitive: true },
          { text: source.label, answer: "LinkedIn; Site", sensitive: false },
        ]),
      );
      expect(saved).toHaveLength(3);

      await db.delete(aiApplications).where(eq(aiApplications.id, id));

      const next = await app.post(profileId, otherJob);
      const body = await next.json();
      const sensitive = questionOf(body, "Você é uma pessoa com deficiência");

      expect(answerFor(body, sensitive.id)).toMatchObject({
        value: "0",
        source: "library",
        status: "filled",
        inferred: false,
      });
    });

    it("does not save a not-shared profile answer the person filled", async () => {
      const { call, profileId, jobId } = await ready();
      const phone = question("phone", { label: "Telefone", kind: "phone" });
      const id = await seed(profileId, jobId, [phone]);

      const res = await call(profileId, confirmPath(id), {
        answers: [{ questionId: "phone", value: "11 90000-0000" }],
      });

      expect(res.status).toBe(200);
      expect((await attempts(profileId))[0].confirmed).toEqual([
        { questionId: "phone", value: "11 90000-0000" },
      ]);
      expect(await library(profileId)).toEqual([]);
    });

    it("never saves an answer withheld from the draft as not shared", async () => {
      const { call, profileId, jobId } = await ready();
      const salary = question("salary", { label: "Pretensão salarial", required: true });
      const id = await seed(profileId, jobId, [salary, why]);

      await db
        .update(aiApplications)
        .set({
          draft: [
            {
              questionId: "salary",
              value: null,
              source: null,
              inferred: false,
              status: "not_shared",
            },
          ],
        })
        .where(eq(aiApplications.id, id));

      const res = await call(profileId, confirmPath(id), {
        answers: [
          { questionId: "salary", value: "R$ 10.000" },
          { questionId: "why", value: "Porque sim" },
        ],
      });

      expect(res.status).toBe(200);
      expect((await res.json()).confirmed).toEqual([
        { questionId: "salary", value: "R$ 10.000" },
        { questionId: "why", value: "Porque sim" },
      ]);
      expect((await library(profileId)).map((item) => item.answer)).toEqual(["Porque sim"]);
    });

    it("rejects incomplete or invalid answers", async () => {
      const { call, profileId, id } = await setup();

      const only = (index: number, value: string | string[] | null) =>
        complete.map((item, at) => (at === index ? { ...item, value } : item));

      const bad: Body["answers"][] = [
        only(0, ""),
        only(0, null),
        only(0, "x".repeat(2_001)),
        only(0, ["lista"]),
        only(1, "5"),
        only(1, "No"),
        only(1, " 1"),
        only(1, null),
        only(1, ["1"]),
        only(2, ["9"]),
        only(2, "0"),
        only(3, ""),
        complete.slice(1),
        [...complete, { questionId: "why", value: "duplicada" }],
        [...complete, { questionId: "ghost", value: "x" }],
        [...complete, { questionId: "resume", value: null }],
        complete.map((item) =>
          item.questionId === "why" ? { ...item, questionId: "ghost" } : item,
        ),
        [],
      ];

      for (const answers of bad) {
        const res = await call(profileId, confirmPath(id), { answers });

        expect(res.status).toBe(422);
        expect(await res.json()).toEqual({ error: "Invalid answers" });
      }

      expect((await attempts(profileId))[0]).toMatchObject({ state: "draft", confirmed: null });
      expect(await library(profileId)).toEqual([]);

      const exact = await call(profileId, confirmPath(id), {
        answers: only(0, "x".repeat(2_000)),
      });

      expect(exact.status).toBe(200);
    });

    it("requires a stored cover letter for a required cover letter question", async () => {
      const { call, profileId, jobId, id } = await setup([why, letter]);
      const answers = [{ questionId: "why", value: "Porque sim" }];

      const missing = await call(profileId, confirmPath(id), { answers });

      expect(missing.status).toBe(409);
      expect(await missing.json()).toEqual({ error: "Generate a cover letter first" });

      await db.insert(applicationPackages).values({ profileId, jobId, coverLetter: "Olá" });

      const ok = await call(profileId, confirmPath(id), { answers });

      expect(ok.status).toBe(200);
    });

    it("expires drafts after 7 days", async () => {
      const { call, profileId, jobId } = await ready();
      const day = 24 * 60 * 60 * 1000;

      const old = await seed(profileId, jobId, [why], {
        preparedAt: new Date(Date.now() - 7 * day - 1000),
      });

      const answers = [{ questionId: "why", value: "ok" }];

      const expired = await call(profileId, confirmPath(old), { answers });

      expect(expired.status).toBe(409);
      expect(await expired.json()).toEqual({ error: "Draft expired" });
      expect((await attempts(profileId))[0].state).toBe("draft");

      await db
        .update(aiApplications)
        .set({ preparedAt: new Date(Date.now() - 6 * day) })
        .where(eq(aiApplications.id, old));

      expect((await call(profileId, confirmPath(old), { answers })).status).toBe(200);
    });

    it("refuses to confirm after applying by hand, after the job closes or from another state", async () => {
      const { call, profileId, jobId, resumeId } = await ready();
      const answers = [{ questionId: "why", value: "ok" }];
      const id = await seed(profileId, jobId, [why]);

      await db.insert(applications).values({ profileId, jobId, resumeId });

      const applied = await call(profileId, confirmPath(id), { answers });

      expect(applied.status).toBe(409);
      expect(await applied.json()).toEqual({ error: "Already applied" });

      const closedJob = await addJob("stone:5", "greenhouse", new Date());
      const closed = await seed(profileId, closedJob, [why]);
      const gone = await call(profileId, confirmPath(closed), { answers });

      expect(gone.status).toBe(404);
      expect(await gone.json()).toEqual({ error: "Job not found" });

      for (const state of [
        "queued",
        "cancelled",
        "assisted",
        "needs_check",
        "submitted",
      ] as const) {
        const spare = await addJob(`stone:${state}`);
        const other = await seed(profileId, spare, [why], { state });

        const res = await call(profileId, confirmPath(other), { answers });

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: "Already in progress" });
      }

      expect((await attempts(profileId)).filter((row) => row.state === "queued")).toHaveLength(1);
      expect(await library(profileId)).toEqual([]);
    });

    it("rolls back the attempt and every library row when saving fails", async () => {
      let saved = 0;

      const failing = build({
        generate: fakeModel().generate,
        saveAnswer: async (...args) => {
          await saveToLibrary(...args);
          saved += 1;

          if (saved === 2) throw new Error("library down");
        },
      });

      const profileId = await profile();
      const id = await seed(profileId, await addJob(), [why, pcd]);

      const res = await failing.call(profileId, confirmPath(id), {
        answers: [
          { questionId: "why", value: "ok" },
          { questionId: "pcd", value: "0" },
        ],
      });

      expect(res.status).toBe(500);
      expect(saved).toBe(2);
      expect((await attempts(profileId))[0]).toMatchObject({ state: "draft", confirmed: null });
      expect(await library(profileId)).toEqual([]);
    });

    it("answers a stale attempt before looking at the body", async () => {
      const { call, profileId, jobId } = await ready();
      const id = await seed(profileId, jobId, [why, letter], { state: "queued" });

      const res = await call(profileId, confirmPath(id), { answers: [] });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Already in progress" });
    });

    it("cancels the draft when the person applies by hand", async () => {
      const { call, profileId, jobId, resumeId } = await ready();
      const id = await seed(profileId, jobId, [why]);

      await repos.applications.apply(profileId, jobId, resumeId);

      const [row] = await attempts(profileId);

      expect(row).toMatchObject({ state: "cancelled", reason: "applied_manually" });
      expect(row.finishedAt).not.toBeNull();

      const res = await call(profileId, confirmPath(id), {
        answers: [{ questionId: "why", value: "ok" }],
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Already applied" });
    });

    it("rejects oversized confirm bodies", async () => {
      const { call, profileId, jobId } = await ready();
      const id = await seed(profileId, jobId, [why]);

      const many = Array.from({ length: 201 }, () => ({ questionId: "why", value: "x" }));

      for (const answers of [
        many,
        [{ questionId: "why", value: "x".repeat(10_001) }],
        [{ questionId: "why", value: Array.from({ length: 51 }, () => "x") }],
      ]) {
        expect((await call(profileId, confirmPath(id), { answers })).status).toBe(422);
      }
    });

    it("cancels drafts and queued attempts only", async () => {
      const { call, profileId, jobId } = await ready();
      const draft = await seed(profileId, jobId, [why]);
      const before = Date.now();

      const first = await call(profileId, cancelPath(draft));
      const body = await first.json();

      expect(first.status).toBe(200);
      expect(body).toMatchObject({ id: draft, state: "cancelled", reason: "cancelled_by_person" });

      const [row] = await attempts(profileId);

      expect(row.finishedAt?.getTime()).toBeGreaterThanOrEqual(before);

      const again = await call(profileId, cancelPath(draft));

      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: "Cannot cancel" });

      const queued = await seed(profileId, jobId, [why], { state: "queued" });

      expect((await call(profileId, cancelPath(queued))).status).toBe(200);

      for (const state of ["assisted", "submitted", "running"] as const) {
        const id = await seed(profileId, await addJob(`stone:${state.length}00`), [why], { state });
        const res = await call(profileId, cancelPath(id));

        expect(res.status).toBe(409);
      }
    });

    it("confirms the Stone form once every visible question is answered", async () => {
      const { post, call, profileId, jobId } = await ready();

      const prepared = await (await post(profileId, jobId)).json();
      const files = new Set(["resume", "cover_letter", "document"]);

      const hidden = prepared.attempt.questions.filter(
        (item: FormQuestion) =>
          item.fields.length > 0 && item.fields.every((field) => field.type === "hidden"),
      );

      expect(hidden.map((item: FormQuestion) => item.label)).toEqual(["Longitude", "Latitude"]);

      for (const item of hidden) {
        expect(answerFor(prepared, item.id)).toEqual({
          questionId: item.id,
          value: null,
          source: null,
          inferred: false,
          status: "filled",
        });
      }

      const answers = prepared.attempt.questions
        .filter((item: FormQuestion) => !files.has(item.kind) && !hidden.includes(item))
        .map((item: FormQuestion) => {
          const [field] = item.fields;

          return {
            questionId: item.id,
            value:
              field.type === "single_select"
                ? field.options[0].value
                : field.type === "multi_select"
                  ? [field.options[0].value]
                  : "x",
          };
        });

      const res = await call(profileId, confirmPath(prepared.attempt.id), { answers });

      expect(res.status).toBe(200);
      expect((await res.json()).state).toBe("queued");

      const saved = (await library(profileId)).map((item) => item.text);

      for (const label of ["Longitude", "Latitude", "Localização"]) {
        expect(saved).not.toContain(label);
      }
    });

    it("never saves a city answer to the library", async () => {
      const { call, profileId, jobId } = await ready();

      const where = question("where", { label: "Localização", kind: "city", required: true });

      const id = await seed(profileId, jobId, [where, why]);

      const res = await call(profileId, confirmPath(id), {
        answers: [
          { questionId: "where", value: "Campinas, SP" },
          { questionId: "why", value: "Porque sim" },
        ],
      });

      expect(res.status).toBe(200);
      expect((await library(profileId)).map((item) => item.text)).toEqual(["Por que a Stone?"]);
    });

    it("withholds a not-shared city that sits in the library from the draft and the model", async () => {
      const { post, model, profileId, jobId } = await ready();

      await db.insert(talentPreferences).values({
        profileId,
        profileFields: { city: { value: "Campinas", share: false } } satisfies ProfileFields,
      });

      await db.transaction((tx) =>
        saveToLibrary(
          tx,
          profileId,
          "Localização",
          "Campinas, SP",
          { sensitive: false },
          new Date(),
        ),
      );

      const body = await (await post(profileId, jobId)).json();

      expect(answerFor(body, questionOf(body, "Localização").id)).toMatchObject({
        value: null,
        status: "not_shared",
      });
      expect(model.calls.map((item) => item.prompt).join("")).not.toContain("Campinas");
    });

    it("replaces an expired draft when preparing again", async () => {
      const { post, profileId, jobId } = await ready();

      const old = await seed(profileId, jobId, [why], {
        preparedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      });

      const res = await post(profileId, jobId);

      expect(res.status).toBe(201);

      const rows = await attempts(profileId);

      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.id === old)).toMatchObject({
        state: "cancelled",
        reason: "expired",
      });
      expect(rows.find((row) => row.id === old)?.finishedAt).toBeInstanceOf(Date);
      expect(rows.filter((row) => row.state === "draft")).toHaveLength(1);

      const fresh = await post(profileId, jobId);

      expect(fresh.status).toBe(409);
    });

    it("refuses to prepare when consent is withdrawn before the attempt is stored", async () => {
      let withdraw = async () => {};

      const { post, profileId, jobId } = await ready({
        form: async () => {
          await withdraw();

          return new Response(stone);
        },
      });

      withdraw = async () => {
        await db
          .update(talentProfiles)
          .set({ aiApplyConsentAt: null })
          .where(eq(talentProfiles.id, profileId));
      };

      const res = await post(profileId, jobId);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "AI Apply not available" });
      expect(await attempts(profileId)).toEqual([]);
    });

    it("stamps an assisted attempt as finished with the app clock", async () => {
      const { post, profileId, jobId } = await ready({
        form: () =>
          new Response(
            JSON.stringify({
              questions: [
                {
                  label: "Laudo",
                  required: true,
                  fields: [{ name: "q", type: "input_file", values: [] }],
                },
              ],
            }),
          ),
      });

      expect((await post(profileId, jobId)).status).toBe(201);

      const [row] = await attempts(profileId);

      expect(row.state).toBe("assisted");
      expect(row.finishedAt?.getTime()).toBe(row.preparedAt.getTime());
      expect(row.createdAt?.getTime()).toBe(row.preparedAt.getTime());
      expect(row.updatedAt?.getTime()).toBe(row.preparedAt.getTime());
    });
    describe("running now", () => {
      const live = "https://www.browserbase.com/devtools-fullscreen/inspector.html?navbar=false";
      const stoneForm = "https://job-boards.greenhouse.io/stone/jobs/8201530003";

      async function queued(app: Awaited<ReturnType<typeof ready>>) {
        await db
          .update(resumes)
          .set({ updatedAt: new Date(Date.now() - 60_000) })
          .where(eq(resumes.id, app.resumeId));

        return seed(app.profileId, app.jobId, [], {
          state: "queued",
          confirmed: [],
          rehearsal: true,
          resumeId: app.resumeId,
          confirmedAt: new Date(),
        });
      }

      function runner(watch: () => Promise<void>) {
        const sessions: string[] = [];

        const page: Page = {
          navigate: watch,
          evaluate: async (expression, schema) =>
            schema.parse(
              expression.includes("loaderData")
                ? {
                    href: stoneForm,
                    form: true,
                    password: false,
                    title: "Job Application for Account Executive at Stone",
                    notices: [],
                    questions: [],
                    required: [],
                  }
                : true,
            ),
          waitFor: async () => true,
          click: async () => undefined,
          type: async () => undefined,
          press: async () => undefined,
          setFiles: async () => undefined,
          screenshot: async () => new Uint8Array(),
          url: async () => stoneForm,
          close: () => undefined,
        };

        const deps: RunnerDeps = {
          repo: repos.aiApply,
          allowlist: [email],
          browserbase: {
            createSession: async () => {
              sessions.push("s1");

              return { id: "s1", connectUrl: "wss://connect.test/s1" };
            },
            liveUrl: async () => live,
            upload: async () => undefined,
            release: async () => undefined,
          },
          openPage: async () => page,
          storage: undefined,
          renderResume: async () => new Uint8Array(),
          budgetMs: 200_000,
          outcomeMs: 30_000,
        };

        return {
          sessions,
          runNow: async (attemptId: string) => {
            await runAiApplication(deps, attemptId, () => new Date());

            return true;
          },
        };
      }

      it("runs a queued rehearsal in the request and answers with its result", async () => {
        const app = await ready();
        const id = await queued(app);
        const other = await profile("outra@example.com", 1);
        const seen: { mine: string | null; theirs: number; listed: { id: string }[] }[] = [];

        const run = runner(async () => {
          const mine = await app.call(app.profileId, `/me/ai-applications/${id}`, undefined, "GET");
          const theirs = await app.call(other, `/me/ai-applications/${id}`, undefined, "GET");
          const listed = await app.call(other, "/me/ai-applications", undefined, "GET");

          seen.push({
            mine: (await mine.json()).liveUrl,
            theirs: theirs.status,
            listed: (await listed.json()).items,
          });
        });

        const { call } = build({ generate: fakeModel().generate, runNow: run.runNow });
        const response = await call(app.profileId, runPath(id));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id, state: "rehearsed", liveUrl: null });
        expect(seen).toEqual([{ mine: live, theirs: 404, listed: [] }]);
        expect(run.sessions).toEqual(["s1"]);
        expect((await attempts(app.profileId))[0]).toMatchObject({
          state: "rehearsed",
          liveUrl: null,
        });
      });

      it("shows the live view only while running", async () => {
        const app = await ready();
        const id = await queued(app);
        const other = await profile("outra@example.com", 1);
        const path = `/me/ai-applications/${id}`;

        await db
          .update(aiApplications)
          .set({ state: "running", liveUrl: live })
          .where(eq(aiApplications.id, id));

        expect(await (await app.call(app.profileId, path, undefined, "GET")).json()).toMatchObject({
          state: "running",
          liveUrl: live,
        });

        const listed = await (
          await app.call(app.profileId, "/me/ai-applications", undefined, "GET")
        ).json();

        expect(listed.items).toMatchObject([{ id, liveUrl: live }]);
        expect((await app.call(other, path, undefined, "GET")).status).toBe(404);
        expect(
          JSON.stringify(
            await (await app.call(other, "/me/ai-applications", undefined, "GET")).json(),
          ),
        ).not.toContain(live);

        await db
          .update(aiApplications)
          .set({ state: "rehearsed" })
          .where(eq(aiApplications.id, id));

        expect(await (await app.call(app.profileId, path, undefined, "GET")).json()).toMatchObject({
          state: "rehearsed",
          liveUrl: null,
        });
      });

      it("answers 202 with the current attempt when the job is not run here", async () => {
        const app = await ready();
        const id = await queued(app);
        const ran: string[] = [];

        const { call } = build({
          generate: fakeModel().generate,
          runNow: async (attemptId) => {
            ran.push(attemptId);

            return false;
          },
        });

        const response = await call(app.profileId, runPath(id));

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({ id, state: "queued", liveUrl: null });
        expect(ran).toEqual([id]);
      });

      it("answers 202 without running an attempt that is not queued", async () => {
        const app = await ready();
        const ran: string[] = [];

        const { call } = build({
          generate: fakeModel().generate,
          runNow: async (attemptId) => {
            ran.push(attemptId);

            return true;
          },
        });

        for (const state of ["draft", "running", "rehearsed", "submitted"] as const) {
          const id = await seed(app.profileId, app.jobId, [], { state });
          const response = await call(app.profileId, runPath(id));

          expect(response.status).toBe(202);
          expect(await response.json()).toMatchObject({ id, state });

          await db.delete(aiApplications).where(eq(aiApplications.id, id));
        }

        expect(ran).toEqual([]);
      });

      it("answers 404 when the attempt is gone after the run", async () => {
        const app = await ready();
        const id = await queued(app);

        const { call } = build({
          generate: fakeModel().generate,
          runNow: async (attemptId) => {
            await db.delete(aiApplications).where(eq(aiApplications.id, attemptId));

            return true;
          },
        });

        const response = await call(app.profileId, runPath(id));

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "Attempt not found" });
      });
    });

    describe("evidence, screenshots and checks", () => {
      const evidence = {
        fields: [{ question: "E-mail", value: "ana@example.com" }],
        files: ["curriculo.pdf"],
        finalUrl: "https://job-boards.greenhouse.io/stone/ok",
      };

      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const key = (profileId: string) => `ai-applications/${profileId}/shot.png`;

      it("shows the evidence and whether a screenshot exists", async () => {
        const { call, profileId, jobId } = await ready();

        const withShot = await seed(profileId, jobId, [why], {
          state: "needs_check",
          evidence,
          screenshotKey: key(profileId),
        });

        const one = await (
          await call(profileId, `/me/ai-applications/${withShot}`, undefined, "GET")
        ).json();

        expect(one).toMatchObject({ evidence, hasScreenshot: true });
        expect(JSON.stringify(one)).not.toContain("shot.png");

        const listed = await (
          await call(profileId, "/me/ai-applications", undefined, "GET")
        ).json();

        expect(listed.items[0]).toMatchObject({ evidence, hasScreenshot: true });

        const bare = await seed(profileId, await addJob("stone:9"), [why]);

        const none = await (
          await call(profileId, `/me/ai-applications/${bare}`, undefined, "GET")
        ).json();

        expect(none).toMatchObject({ evidence: null, hasScreenshot: false });
      });

      it("serves the screenshot privately to its owner only", async () => {
        const profileId = await profile();
        const otherId = await profile("outra@example.com", 1);
        const jobId = await addJob();
        const files = memoryStorage({ [key(profileId)]: png, [key(otherId)]: new Uint8Array([1]) });
        const app = build({ generate: fakeModel().generate, storage: files.storage });

        const id = await seed(profileId, jobId, [why], {
          state: "needs_check",
          screenshotKey: key(profileId),
        });

        const foreign = await seed(otherId, jobId, [why], {
          state: "needs_check",
          screenshotKey: key(otherId),
        });

        const res = await app.call(profileId, shotPath(id), undefined, "GET");

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
        expect(files.reads).toEqual([key(profileId)]);

        for (const missing of [foreign, "not-a-uuid", "00000000-0000-4000-8000-000000000001"]) {
          const res = await app.call(profileId, shotPath(missing), undefined, "GET");

          expect(res.status).toBe(404);
          expect(await res.json()).toEqual({ error: "Screenshot not found" });
        }

        expect(files.reads).toEqual([key(profileId)]);
      });

      it("answers 404 when there is no key, no object or no storage", async () => {
        const profileId = await profile();
        const jobId = await addJob();
        const files = memoryStorage({});
        const app = build({ generate: fakeModel().generate, storage: files.storage });
        const noKey = await seed(profileId, jobId, [why], { state: "assisted" });

        const gone = await seed(profileId, await addJob("stone:9"), [why], {
          state: "assisted",
          screenshotKey: key(profileId),
        });

        for (const id of [noKey, gone]) {
          const res = await app.call(profileId, shotPath(id), undefined, "GET");

          expect(res.status).toBe(404);
          expect(await res.json()).toEqual({ error: "Screenshot not found" });
        }

        expect(files.reads).toEqual([key(profileId)]);

        const bare = build({ generate: fakeModel().generate });
        const res = await bare.call(profileId, shotPath(gone), undefined, "GET");

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "Screenshot not found" });
      });

      it("records the application when the person says it was sent", async () => {
        const { call, profileId, jobId, resumeId } = await ready();

        const id = await seed(profileId, jobId, [why], {
          state: "needs_check",
          evidence,
          resumeId,
        });

        const res = await call(profileId, checkPath(id), { sent: true });

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ id, state: "submitted", evidence });

        const [row] = await attempts(profileId);

        const [application] = await db
          .select()
          .from(applications)
          .where(eq(applications.profileId, profileId));

        expect(row).toMatchObject({ state: "submitted", reason: null });
        expect(row.finishedAt).toBeInstanceOf(Date);
        expect(application).toMatchObject({ jobId, resumeId, channel: "ai_apply", status: "sent" });
        expect(
          await db
            .select()
            .from(applicationEvents)
            .where(eq(applicationEvents.applicationId, application.id)),
        ).toHaveLength(1);

        const again = await call(profileId, checkPath(id), { sent: true });

        expect(again.status).toBe(409);
        expect(await again.json()).toEqual({ error: "Nothing to check" });
        expect(await db.select().from(applications)).toHaveLength(1);
      });

      it("keeps the existing application when the person had already applied", async () => {
        const { call, profileId, jobId, resumeId } = await ready();
        const id = await seed(profileId, jobId, [why], { state: "needs_check" });

        await db.insert(applications).values({ profileId, jobId, resumeId });

        const res = await call(profileId, checkPath(id), { sent: true });

        expect(res.status).toBe(200);
        expect((await res.json()).state).toBe("submitted");
        expect(await db.select().from(applications)).toHaveLength(1);
        expect(await db.select().from(applicationEvents)).toEqual([]);
      });

      it("closes the attempt as assisted when the person says it was not sent", async () => {
        const { call, profileId, jobId } = await ready();
        const id = await seed(profileId, jobId, [why], { state: "needs_check" });

        const res = await call(profileId, checkPath(id), { sent: false });

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ state: "assisted", reason: "not_sent" });
        expect((await attempts(profileId))[0].finishedAt).toBeInstanceOf(Date);
        expect(await db.select().from(applications)).toEqual([]);
      });

      it("refuses to check attempts in any other state, foreign attempts and bad bodies", async () => {
        const { call, profileId, jobId } = await ready();
        const otherId = await profile("outra@example.com", 1);
        const foreign = await seed(otherId, jobId, [why], { state: "needs_check" });

        for (const state of [
          "draft",
          "queued",
          "running",
          "submitting",
          "rehearsed",
          "submitted",
          "assisted",
          "cancelled",
        ] as const) {
          await db.delete(aiApplications).where(eq(aiApplications.profileId, profileId));

          const id = await seed(profileId, jobId, [why], { state });
          const res = await call(profileId, checkPath(id), { sent: true });

          expect(res.status).toBe(409);
          expect(await res.json()).toEqual({ error: "Nothing to check" });
          expect((await attempts(profileId))[0].state).toBe(state);
        }

        for (const id of [foreign, "not-a-uuid", "00000000-0000-4000-8000-000000000001"]) {
          const res = await call(profileId, checkPath(id), { sent: true });

          expect(res.status).toBe(404);
          expect(await res.json()).toEqual({ error: "Attempt not found" });
        }

        const id = await seed(profileId, await addJob("stone:9"), [why], { state: "needs_check" });

        expect((await call(profileId, checkPath(id), {})).status).toBe(422);
        expect((await call(profileId, checkPath(id), { sent: "yes" })).status).toBe(422);
        expect((await attempts(otherId))[0].state).toBe("needs_check");
        expect(await db.select().from(applications)).toEqual([]);
      });

      it("lets a person who lost access still resolve a check", async () => {
        const { profileId, jobId } = await ready();
        const first = await seed(profileId, jobId, [why], { state: "needs_check" });

        const second = await seed(profileId, await addJob("stone:9"), [why], {
          state: "needs_check",
        });

        await repos.talent.setAiApplyConsent(profileId, false, new Date());

        const closed = build({ allowlist: [], generate: null });

        expect((await closed.call(profileId, checkPath(first), { sent: true })).status).toBe(200);
        expect((await closed.call(profileId, checkPath(second), { sent: false })).status).toBe(200);
        expect((await attempts(profileId)).map((row) => row.state).sort()).toEqual([
          "assisted",
          "submitted",
        ]);
      });

      it("confirms a rehearsed attempt again within seven days of the rehearsal", async () => {
        const events: string[] = [];

        const storage: ObjectStorage = {
          ...memoryStorage({}).storage,
          remove: async (keys) => {
            events.push(`remove ${keys.join(",")}`);
          },
        };

        const { call, profileId, jobId } = await ready({
          storage,
          enqueueRun: async (attemptId) => {
            events.push("enqueue");
            await repos.background.enqueue("ai_apply", attemptId);
          },
        });

        const day = 24 * 60 * 60 * 1000;

        const id = await seed(profileId, jobId, [why, pcd, source, mail, cv], {
          state: "rehearsed",
          rehearsal: true,
          preparedAt: new Date(Date.now() - 30 * day),
          finishedAt: new Date(Date.now() - 6 * day),
          evidence,
          screenshotKey: key(profileId),
        });

        const res = await call(profileId, confirmPath(id), { answers: complete, rehearsal: false });

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
          id,
          state: "queued",
          rehearsal: false,
          evidence: null,
          hasScreenshot: false,
        });
        expect(await attempts(profileId)).toEqual([
          expect.objectContaining({ evidence: null, screenshotKey: null }),
        ]);
        expect(events).toEqual([`remove ${key(profileId)}`, "enqueue"]);
        expect(await db.select().from(backgroundJobs)).toEqual([
          expect.objectContaining({ kind: "ai_apply", subject: id }),
        ]);
        expect((await library(profileId)).length).toBeGreaterThan(0);
      });

      it("still queues a re-confirmed rehearsal when its old screenshot cannot be removed", async () => {
        const logged = vi.spyOn(console, "error");

        const storage: ObjectStorage = {
          ...memoryStorage({}).storage,
          remove: async (keys) => {
            throw Object.assign(new Error(`cannot remove ${keys.join(",")}`), { code: "EIO" });
          },
        };

        const { call, profileId, jobId } = await ready({ storage });

        const id = await seed(profileId, jobId, [why, pcd, source, mail, cv], {
          state: "rehearsed",
          rehearsal: true,
          preparedAt: new Date(),
          finishedAt: new Date(),
          evidence,
          screenshotKey: key(profileId),
        });

        const res = await call(profileId, confirmPath(id), { answers: complete });

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ state: "queued", hasScreenshot: false });
        expect(logged).toHaveBeenCalledWith("AI application screenshot not removed", {
          name: "Error",
          code: "EIO",
        });
        expect(JSON.stringify(logged.mock.calls)).not.toContain(profileId);

        logged.mockRestore();
      });

      it("refuses to confirm a rehearsal after seven days, or from needs_check and submitted", async () => {
        const { call, profileId, jobId } = await ready();
        const day = 24 * 60 * 60 * 1000;
        const answers = [{ questionId: "why", value: "ok" }];

        const old = await seed(profileId, jobId, [why], {
          state: "rehearsed",
          preparedAt: new Date(),
          finishedAt: new Date(Date.now() - 7 * day - 1000),
        });

        const expired = await call(profileId, confirmPath(old), { answers });

        expect(expired.status).toBe(409);
        expect(await expired.json()).toEqual({ error: "Draft expired" });

        for (const state of ["needs_check", "submitted"] as const) {
          await db.delete(aiApplications).where(eq(aiApplications.profileId, profileId));

          const id = await seed(profileId, jobId, [why], { state });
          const res = await call(profileId, confirmPath(id), { answers });

          expect(res.status).toBe(409);
          expect(await res.json()).toEqual({ error: "Already in progress" });
        }
      });
    });
  });
});
