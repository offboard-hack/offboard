import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import type { ConfirmedAnswer, FormQuestion, ResumeContent } from "@offboard/db/schema";
import {
  aiApplications,
  applicationEvents,
  applicationPackages,
  applications,
  defaultOrgId,
  jobs,
  offboardingCases,
  plans,
  resumes,
  subscriptions,
  talentPreferences,
  talentProfiles,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositories } from "../../repositories.js";
import { BrowserbaseError } from "./browser/browserbase.js";
import type { Page } from "./browser/cdp.js";
import type { FormPage, OutcomePage } from "./browser/greenhouse-form.js";
import { runAiApplication, type RunnerDeps } from "./runner.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const email = "ana.pessoal@example.com";
const jobUrl = "https://job-boards.greenhouse.io/acme/jobs/7";
const confirmationUrl = `${jobUrl}/confirmation`;
const submitSelector = '#application-form button[type="submit"]';
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

const resume: ResumeContent = {
  headline: { id: "h", text: "Engenheira" },
  summary: { id: "s", text: "Backend" },
  experiences: [],
  education: [],
  skills: [],
  languages: [],
  contact: { email: "ana@example.com", phone: "11 97777-6666", city: "Campinas", links: [] },
};

const question = (
  id: string,
  label: string,
  kind: FormQuestion["kind"],
  fields: FormQuestion["fields"],
  required = true,
) =>
  ({
    id,
    label,
    required,
    section: "questions",
    fields,
    kind,
    sensitive: false,
  }) satisfies FormQuestion;

const text = (name: string) =>
  ({ name, type: "text", options: [] }) satisfies FormQuestion["fields"][number];

const pcdOptions = [
  { label: "Sim", value: "1" },
  { label: "Não", value: "0" },
];

const letterWithText = question(
  "cover_letter",
  "Cover Letter",
  "cover_letter",
  [
    { name: "cover_letter", type: "file", options: [] },
    { name: "cover_letter_text", type: "textarea", options: [] },
  ],
  false,
);

const letterFileOnly = question(
  "cover_letter",
  "Cover Letter",
  "cover_letter",
  [{ name: "cover_letter", type: "file", options: [] }],
  false,
);

const baseQuestions = [
  question("first_name", "Nome", "first_name", [text("first_name")]),
  question("last_name", "Sobrenome", "last_name", [text("last_name")]),
  question("email", "Email", "email", [text("email")]),
  question("resume", "Currículo", "resume", [{ name: "resume", type: "file", options: [] }]),
  question("question_1", "Por que a Acme?", "custom", [text("question_1")]),
  question("question_2", "Você é PcD?", "custom", [
    { name: "question_2", type: "single_select", options: pcdOptions },
  ]),
  question("question_3", "Como soube da vaga?", "custom", [text("question_3")], false),
  question(
    "latitude",
    "Latitude",
    "custom",
    [{ name: "latitude", type: "hidden", options: [] }],
    false,
  ),
];

const baseConfirmed: ConfirmedAnswer[] = [
  { questionId: "first_name", value: "Outro" },
  { questionId: "last_name", value: "Nome" },
  { questionId: "email", value: "outro@example.com" },
  { questionId: "question_1", value: "Gosto de pagamentos." },
  { questionId: "question_2", value: "0" },
  { questionId: "question_3", value: null },
];

const quiet: OutcomePage = {
  path: "/acme/jobs/7",
  form: true,
  frames: [],
  errors: [],
  confirmations: [],
};

const outcomes = {
  confirmed: {
    path: "/acme/jobs/7/confirmation",
    form: false,
    frames: [],
    errors: [],
    confirmations: [{ text: "Recebemos sua inscrição.", visible: true }],
  },
  blocked: {
    ...quiet,
    frames: [{ src: "https://www.recaptcha.net/recaptcha/api2/bframe?k=x", visible: true }],
  },
  invalid: { ...quiet, errors: [{ text: "Este campo é obrigatório.", visible: true }] },
  timeout: quiet,
} satisfies Record<string, OutcomePage>;

type ThrowPoint = "navigate" | "type" | "submit" | "screenshot" | "url" | "close";

type PageSetup = {
  questions?: FormQuestion[];
  form?: Partial<FormPage>;
  extraLive?: FormPage["questions"];
  before?: OutcomePage;
  outcome?: keyof typeof outcomes;
  throwOn?: ThrowPoint;
  rejectUpload?: boolean;
  duringFill?: () => Promise<void>;
};

const literal = (expression: string) => {
  const match = /querySelector(?:All)?\(("(?:[^"\\]|\\.)*")\)/.exec(expression);
  const selector = match?.[1] === undefined ? "" : JSON.parse(match[1]);

  return /^\[id="(.*)"\]$/.exec(selector)?.[1] ?? selector;
};

const fakePage = (setup: PageSetup = {}) => {
  const actions: string[] = [];
  const screenshots: ({ fullPage?: boolean } | undefined)[] = [];
  const values = new Map<string, string>();
  const shown = new Map<string, string>();
  const checked = new Set<string>();
  let focused = "";
  let clicked = false;
  let filling = false;
  let closes = 0;

  const outcome = setup.outcome ?? "confirmed";

  const trip = (point: ThrowPoint) => {
    if (setup.throwOn === point) throw new Error(`boom at ${point}`);
  };

  const live = (questions: FormQuestion[]) =>
    questions.map((item) => ({
      required: item.required,
      fields: item.fields.map((field) => ({
        name: field.name,
        values: field.options.map((option) => ({ value: option.value })),
      })),
    }));

  const formPage = () =>
    ({
      href: jobUrl,
      form: true,
      password: false,
      title: "Job Application for Backend at Acme",
      notices: [],
      questions: [...live(setup.questions ?? baseQuestions), ...(setup.extraLive ?? [])],
      required: [],
      ...setup.form,
    }) satisfies FormPage;

  const reply = (expression: string) => {
    if (expression.includes("loaderData")) return formPage();

    if (expression.includes("armed = true")) {
      actions.push("guard");

      return true;
    }

    if (expression.includes("armed = false")) {
      actions.push("lift");

      return true;
    }

    if (expression.includes('querySelectorAll("iframe")')) {
      return clicked ? outcomes[outcome] : (setup.before ?? quiet);
    }

    if (expression.includes('[role=\\"option\\"]')) {
      return pcdOptions.map((option, index) => ({
        id: `react-select-question_2-option-${index}`,
        text: option.label,
      }));
    }

    if (expression.includes('type=\\"checkbox\\"')) return [...checked];

    const id = literal(expression);

    if (expression.endsWith("?.checked ?? null")) return checked.has(id.split("_").at(-1) ?? "");

    if (expression.endsWith(" !== null")) return true;

    if (expression.includes(".select__single-value")) return shown.get(id) ?? null;

    if (expression.endsWith("?.tagName ?? null")) {
      return id === "cover_letter_text" ? "TEXTAREA" : "INPUT";
    }

    if (expression.endsWith("?.value ?? null")) return values.get(id) ?? "";

    throw new Error(`unexpected expression ${expression}`);
  };

  const page: Page = {
    async navigate(target) {
      actions.push(`navigate ${target}`);
      trip("navigate");
    },
    async evaluate(expression, schema) {
      return schema.parse(reply(expression));
    },
    async waitFor(expression) {
      if (expression.includes('location.pathname.includes("/confirmation")')) {
        return outcome === "confirmed";
      }

      if (expression.includes("file-upload__filename")) return !setup.rejectUpload;

      return true;
    },
    async click(selector) {
      actions.push(`click ${selector}`);

      if (selector === submitSelector) {
        trip("submit");
        clicked = true;

        return;
      }

      const id = literal(`querySelector(${JSON.stringify(selector)})`);
      const option = /^react-select-question_2-option-(\d+)$/.exec(id);

      if (option !== null) {
        shown.set("question_2", pcdOptions[Number(option[1])].label);

        return;
      }

      const tick = /^question_4_(\d+)$/.exec(id);

      if (tick !== null) {
        checked.add(tick[1]);

        return;
      }

      focused = id;
    },
    async type(typed) {
      actions.push(`type ${typed}`);
      trip("type");

      if (!filling) {
        filling = true;
        await setup.duringFill?.();
      }

      if (focused !== "question_2") values.set(focused, typed);
    },
    async press(key) {
      actions.push(`press ${key}`);
    },
    async setFiles(selector, paths) {
      actions.push(`setFiles ${selector} ${paths.join(",")}`);
    },
    async screenshot(options) {
      screenshots.push(options);
      trip("screenshot");

      return png;
    },
    async url() {
      trip("url");

      return clicked && outcome === "confirmed" ? confirmationUrl : jobUrl;
    },
    close() {
      closes += 1;
      trip("close");
    },
  };

  return {
    page,
    actions,
    screenshots,
    closes: () => closes,
    submits: () => actions.filter((action) => action === `click ${submitSelector}`).length,
    lifts: () => actions.filter((action) => action === "lift").length,
  };
};

type Upload = { sessionId: string; name: string; bytes: Uint8Array; type: string };

const liveView =
  "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=s1&navbar=false";

const fakeBrowserbase = (
  setup: {
    failCreate?: number;
    failUpload?: boolean;
    failRelease?: boolean;
    failLive?: boolean;
  } = {},
) => {
  const uploads: Upload[] = [];
  const released: string[] = [];
  const watched: string[] = [];
  let created = 0;

  const browserbase = {
    async createSession() {
      created += 1;

      if (setup.failCreate !== undefined) {
        throw new BrowserbaseError("create session", setup.failCreate);
      }

      return { id: "session-1", connectUrl: "wss://connect.test/session-1" };
    },
    async liveUrl(sessionId: string) {
      watched.push(sessionId);

      if (setup.failLive) throw new BrowserbaseError("live view", 404);

      return liveView;
    },
    async upload(sessionId: string, file: { name: string; bytes: Uint8Array; type: string }) {
      uploads.push({ sessionId, ...file });

      if (setup.failUpload) throw new BrowserbaseError("upload", 500);
    },
    async release(sessionId: string) {
      released.push(sessionId);

      if (setup.failRelease) throw new BrowserbaseError("release", 500);
    },
  };

  return { browserbase, uploads, released, watched, created: () => created };
};

const fakeStorage = (setup: { failRemove?: boolean } = {}) => {
  const stored: { key: string; data: Uint8Array; contentType: string }[] = [];
  const objects = new Map<string, Uint8Array>();

  return {
    stored,
    objects,
    storage: {
      async put(key: string, data: Uint8Array, contentType: string) {
        stored.push({ key, data, contentType });
        objects.set(key, data);
      },
      async get(key: string) {
        return objects.get(key) ?? null;
      },
      async remove(keys: string[]) {
        if (setup.failRemove) {
          throw Object.assign(new Error(`cannot remove ${keys.join(",")}`), { code: "EACCES" });
        }

        for (const key of keys) objects.delete(key);
      },
      async removePrefix(prefix: string) {
        for (const key of objects.keys()) {
          if (key.startsWith(prefix)) objects.delete(key);
        }
      },
    },
  };
};

describe.skipIf(!url)("ai apply runner", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const clock = new Date("2026-11-25T15:00:00.000Z");
  const now = () => clock;
  const later = () => new Date(clock.getTime() + 15 * 60_000 + 1);

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function onPlan(
    slug: string,
    status: (typeof subscriptions.$inferInsert)["status"] = "active",
  ) {
    const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, slug));

    await db
      .update(subscriptions)
      .set({ planId: plan.id, status })
      .where(eq(subscriptions.orgId, defaultOrgId));
  }

  async function profile() {
    await onPlan("platinum-premium");

    const [first] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    const created = await repos.talent.enable({
      orgId: defaultOrgId,
      caseId: first.id,
      personalEmail: email,
      sponsoredUntil: "2099-12-31",
    });

    if (
      created === "case_not_found" ||
      created === "already_enabled" ||
      created === "email_taken"
    ) {
      throw new Error(created);
    }

    await repos.talent.setAiApplyConsent(created.id, true, new Date());
    await db
      .update(talentProfiles)
      .set({ name: " Ana  Maria Souza " })
      .where(eq(talentProfiles.id, created.id));

    return created.id;
  }

  type AttemptSetup = {
    rehearsal?: boolean;
    questions?: FormQuestion[];
    confirmed?: ConfirmedAnswer[];
    state?: "queued" | "running" | "submitting" | "rehearsed";
    updatedAt?: Date;
    letter?: string;
    jobUrl?: string;
  };

  async function attempt(setup: AttemptSetup = {}) {
    const profileId = await profile();

    const [base] = await db
      .insert(resumes)
      .values({ profileId, kind: "base", content: resume, updatedAt: earlier() })
      .returning({ id: resumes.id });

    const [job] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "greenhouse",
        sourceKey: "acme:7",
        title: "Backend",
        company: "Acme",
        url: setup.jobUrl ?? jobUrl,
      })
      .returning({ id: jobs.id });

    if (setup.letter !== undefined) {
      await db
        .insert(applicationPackages)
        .values({ profileId, jobId: job.id, coverLetter: setup.letter, updatedAt: earlier() });
    }

    const [row] = await db
      .insert(aiApplications)
      .values({
        profileId,
        jobId: job.id,
        state: setup.state ?? "queued",
        form: { questions: setup.questions ?? baseQuestions },
        draft: [],
        confirmed: setup.confirmed ?? baseConfirmed,
        rehearsal: setup.rehearsal ?? false,
        resumeId: base.id,
        preparedAt: new Date(),
        confirmedAt: new Date(),
        updatedAt: setup.updatedAt ?? new Date(),
      })
      .returning({ id: aiApplications.id });

    return { id: row.id, profileId, jobId: job.id, resumeId: base.id };
  }

  const earlier = () => new Date(Date.now() - 60_000);

  const stateOf = async (id: string) =>
    (await db.select().from(aiApplications).where(eq(aiApplications.id, id)))[0];

  type Rig = {
    page?: PageSetup;
    browserbase?: Parameters<typeof fakeBrowserbase>[0];
    storage?: Parameters<typeof fakeStorage>[0];
    deps?: Partial<RunnerDeps>;
    failConnect?: boolean;
  };

  function rig(setup: Rig = {}) {
    const fake = fakePage(setup.page);
    const bb = fakeBrowserbase(setup.browserbase);
    const files = fakeStorage(setup.storage);
    const opened: string[] = [];
    const rendered: { name: string; content: ResumeContent }[] = [];

    const deps: RunnerDeps = {
      repo: repos.aiApply,
      companyPlan: repos.billing.companyPlan,
      browserbase: bb.browserbase,
      openPage: async (connectUrl) => {
        opened.push(connectUrl);

        if (setup.failConnect) throw new Error("no websocket");

        return fake.page;
      },
      storage: files.storage,
      renderResume: async (name, content) => {
        rendered.push({ name, content });

        return Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
      },
      budgetMs: 200_000,
      outcomeMs: 30_000,
      ...setup.deps,
    };

    return { ...fake, ...bb, ...files, opened, rendered, deps };
  }

  describe("records evidence and the application", () => {
    it("submits once, records the application and keeps the evidence", async () => {
      const { id, profileId, jobId, resumeId } = await attempt();
      const run = rig();

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "submitted",
        reason: null,
        finishedAt: clock,
        screenshotKey: `ai-applications/${profileId}/${id}.png`,
        evidence: {
          fields: [
            { question: "Nome", value: "Ana" },
            { question: "Sobrenome", value: "Maria Souza" },
            { question: "Email", value: email },
            { question: "Por que a Acme?", value: "Gosto de pagamentos." },
            { question: "Você é PcD?", value: "Não" },
          ],
          files: ["curriculo.pdf"],
          finalUrl: confirmationUrl,
        },
      });

      const [application] = await db.select().from(applications);

      expect(application).toMatchObject({
        profileId,
        jobId,
        resumeId,
        channel: "ai_apply",
        status: "sent",
        appliedAt: clock,
      });
      expect(await db.select().from(applicationEvents)).toEqual([
        expect.objectContaining({ applicationId: application.id, status: "sent" }),
      ]);
      expect(run.opened).toEqual(["wss://connect.test/session-1"]);
      expect(run.actions[0]).toBe(`navigate ${jobUrl}`);
      expect(run.actions).toContain('setFiles [id="resume"] /tmp/.uploads/curriculo.pdf');
      expect(run.actions).toContain("type Ana");
      expect(run.actions).not.toContain("type Outro");
      expect(run.uploads).toEqual([
        {
          sessionId: "session-1",
          name: "curriculo.pdf",
          bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
          type: "application/pdf",
        },
      ]);
      expect(run.rendered).toEqual([
        {
          name: " Ana  Maria Souza ",
          content: { ...resume, contact: { ...resume.contact, phone: null, city: null } },
        },
      ]);
      expect(run.submits()).toBe(1);
      expect(run.screenshots).toEqual([{ fullPage: true }]);
      expect(run.stored).toEqual([
        { key: `ai-applications/${profileId}/${id}.png`, data: png, contentType: "image/png" },
      ]);
      expect(run.released).toEqual(["session-1"]);
      expect(run.closes()).toBe(1);
    });

    it("opens the canonical Greenhouse form instead of the listed job URL", async () => {
      const { id } = await attempt({ jobUrl: "https://careers.acme.com/vagas?gh_jid=7" });
      const run = rig();

      await runAiApplication(run.deps, id, now);

      expect((await stateOf(id)).state).toBe("submitted");
      expect(run.actions[0]).toBe("navigate https://job-boards.greenhouse.io/acme/jobs/7");
    });

    it("types the cover letter where the form takes text", async () => {
      const letter = "Olá, Acme.\n\nQuero trabalhar com vocês.";
      const { id } = await attempt({ questions: [...baseQuestions, letterWithText], letter });
      const run = rig({ page: { questions: [...baseQuestions, letterWithText] } });

      await runAiApplication(run.deps, id, now);

      const row = await stateOf(id);

      expect(row.state).toBe("submitted");
      expect(row.evidence?.fields).toContainEqual({ question: "Cover Letter", value: letter });
      expect(row.evidence?.files).toEqual(["curriculo.pdf"]);
      expect(run.actions).toContain(`type ${letter}`);
      expect(run.uploads.map((upload) => upload.name)).toEqual(["curriculo.pdf"]);
    });

    it("uploads the cover letter as a PDF where the form only takes a file", async () => {
      const { id } = await attempt({
        questions: [...baseQuestions, letterFileOnly],
        letter: "Olá.",
      });

      const run = rig({ page: { questions: [...baseQuestions, letterFileOnly] } });

      await runAiApplication(run.deps, id, now);

      const row = await stateOf(id);

      expect(row.state).toBe("submitted");
      expect(row.evidence?.files).toEqual(["curriculo.pdf", "carta-de-apresentacao.pdf"]);
      expect(row.evidence?.fields.map((field) => field.question)).not.toContain("Cover Letter");
      expect(run.uploads.map((upload) => upload.name)).toEqual([
        "curriculo.pdf",
        "carta-de-apresentacao.pdf",
      ]);
      expect(new TextDecoder().decode(run.uploads[1]?.bytes.slice(0, 5))).toBe("%PDF-");
      expect(run.actions).toContain(
        'setFiles [id="cover_letter"] /tmp/.uploads/carta-de-apresentacao.pdf',
      );
    });

    it("records multi-select labels and skips a form without a résumé field", async () => {
      const source = question("question_4", "Onde nos viu?", "custom", [
        {
          name: "question_4",
          type: "multi_select",
          options: [
            { label: "LinkedIn", value: "10" },
            { label: "Indicação", value: "11" },
          ],
        },
      ]);

      const questions = [baseQuestions[0], source];

      const { id } = await attempt({
        questions,
        confirmed: [
          { questionId: "first_name", value: "Ana" },
          { questionId: "question_4", value: ["11", "10"] },
        ],
      });

      const run = rig({ page: { questions } });

      await runAiApplication(run.deps, id, now);

      const row = await stateOf(id);

      expect(row.state).toBe("submitted");
      expect(row.evidence).toMatchObject({
        fields: [
          { question: "Nome", value: "Ana" },
          { question: "Onde nos viu?", value: ["LinkedIn", "Indicação"] },
        ],
        files: [],
      });
      expect(run.uploads).toEqual([]);
      expect(run.rendered).toEqual([]);
    });
  });

  describe("rehearses without submitting", () => {
    it("fills, screenshots and stops before the click", async () => {
      const { id, profileId } = await attempt({ rehearsal: true });
      const run = rig();

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "rehearsed",
        reason: null,
        finishedAt: clock,
        screenshotKey: `ai-applications/${profileId}/${id}.png`,
        evidence: { files: [], finalUrl: jobUrl },
      });
      expect(run.actions).toContain("guard");
      expect(run.actions).toContain("type Gosto de pagamentos.");
      expect(run.submits()).toBe(0);
      expect(run.lifts()).toBe(0);
      expect(run.actions.some((action) => action.startsWith("setFiles"))).toBe(false);
      expect(run.uploads).toEqual([]);
      expect(run.rendered).toEqual([]);
      expect(run.screenshots).toEqual([{ fullPage: true }]);
      expect(await db.select().from(applications)).toEqual([]);
      expect(run.released).toEqual(["session-1"]);
    });

    it("rehearses without a stored screenshot when storage is off", async () => {
      const { id } = await attempt({ rehearsal: true });
      const run = rig({ deps: { storage: undefined } });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "rehearsed", screenshotKey: null });
      expect(run.screenshots).toEqual([]);
    });
  });

  describe("shows the live view only while running", () => {
    for (const rehearsal of [true, false]) {
      it(`stores the live view after the session and clears it at the end (rehearsal ${rehearsal})`, async () => {
        const { id } = await attempt({ rehearsal });
        const seen: (string | null)[] = [];

        const run = rig({
          page: {
            duringFill: async () => {
              seen.push((await stateOf(id)).liveUrl);
            },
          },
        });

        await runAiApplication(run.deps, id, now);

        expect(seen).toEqual([liveView]);
        expect(run.watched).toEqual(["session-1"]);
        expect(await stateOf(id)).toMatchObject({
          state: rehearsal ? "rehearsed" : "submitted",
          liveUrl: null,
        });
      });
    }

    it("clears the live view when the run ends early", async () => {
      const { id } = await attempt();
      const run = rig({ page: { throwOn: "navigate" } });
      vi.spyOn(console, "error");

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "assisted",
        reason: "error",
        liveUrl: null,
      });
    });

    it("runs without a live view when Browserbase cannot give one", async () => {
      const { id } = await attempt({ rehearsal: true });
      const seen: (string | null)[] = [];
      const logged = vi.spyOn(console, "error");

      const run = rig({
        browserbase: { failLive: true },
        page: {
          duringFill: async () => {
            seen.push((await stateOf(id)).liveUrl);
          },
        },
      });

      await runAiApplication(run.deps, id, now);

      expect(seen).toEqual([null]);
      expect(await stateOf(id)).toMatchObject({ state: "rehearsed", liveUrl: null });
      expect(logged).toHaveBeenCalledExactlyOnceWith("Browserbase live view failed", {
        name: "BrowserbaseError",
      });
      expect(run.released).toEqual(["session-1"]);
    });

    it("runs on and never logs the live view when it cannot be stored", async () => {
      const { id } = await attempt();
      const logged = vi.spyOn(console, "error");
      const run = rig();

      run.deps.repo = {
        ...repos.aiApply,
        showLive: async (_attemptId, url) => {
          throw new Error(`update failed for ${url}`);
        },
      };

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "submitted", liveUrl: null });
      expect(logged).toHaveBeenCalledExactlyOnceWith("Browserbase live view failed", {
        name: "Error",
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("browserbase.com");
    });
  });

  describe("falls back when the form changed", () => {
    it("stops before filling when a new required question appeared", async () => {
      const { id } = await attempt();

      const run = rig({
        page: { extraLive: [{ required: true, fields: [{ name: "question_9", values: [] }] }] },
      });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "assisted",
        reason: "form_changed",
        evidence: { fields: [], files: [], finalUrl: jobUrl },
      });
      expect(run.actions).not.toContain("guard");
      expect(run.submits()).toBe(0);
      expect(run.released).toEqual(["session-1"]);
    });

    it("stops when a confirmed option was removed", async () => {
      const { id } = await attempt();

      const narrowed = baseQuestions.map((item) =>
        item.id === "question_2"
          ? { ...item, fields: [{ ...item.fields[0], options: [pcdOptions[0]] }] }
          : item,
      );

      const run = rig({ page: { questions: narrowed } });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "assisted", reason: "form_changed" });
      expect(run.submits()).toBe(0);
    });

    it("gives up without a click when the page already shows errors", async () => {
      const { id } = await attempt();
      const run = rig({ page: { before: outcomes.invalid } });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "assisted", reason: "form_changed" });
      expect(run.submits()).toBe(0);
      expect(await db.select().from(applications)).toEqual([]);
    });

    it("reports a form the click did not get through", async () => {
      const { id } = await attempt();
      const run = rig({ page: { outcome: "invalid" } });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "assisted", reason: "form_changed" });
      expect(run.submits()).toBe(1);
      expect(run.stored).toHaveLength(1);
    });

    it("reports a file the form did not take", async () => {
      const { id } = await attempt();
      const run = rig({ page: { rejectUpload: true } });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "assisted", reason: "upload_failed" });
      expect(run.submits()).toBe(0);
    });

    it("maps a closed job, a sign-in wall and a blocked page", async () => {
      const pages = [
        [{ form: false, href: `${jobUrl}?error=true` }, "job_closed"],
        [{ form: false, password: true }, "login_required"],
        [{ form: false, title: "Access denied" }, "blocked"],
      ] satisfies [Partial<FormPage>, string][];

      for (const [form, reason] of pages) {
        await seedDatabase(db, testSeedFixtures);

        const { id } = await attempt();
        const run = rig({ page: { form } });

        await runAiApplication(run.deps, id, now);

        expect(await stateOf(id)).toMatchObject({ state: "assisted", reason });
        expect(run.submits()).toBe(0);
        expect(run.released).toEqual(["session-1"]);
      }
    });
  });

  describe("outcomes after the click", () => {
    it("asks for a check when a captcha shows after the click", async () => {
      const { id, profileId } = await attempt();
      const run = rig({ page: { outcome: "blocked" } });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "needs_check",
        reason: null,
        finishedAt: null,
        screenshotKey: `ai-applications/${profileId}/${id}.png`,
      });
      expect(run.submits()).toBe(1);
      expect(await db.select().from(applications)).toEqual([]);
    });

    it("moves a timeout to needs_check", async () => {
      const { id } = await attempt();
      const run = rig({ page: { outcome: "timeout" } });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "needs_check",
        reason: null,
        finishedAt: null,
        evidence: { finalUrl: jobUrl },
      });
      expect(run.submits()).toBe(1);
      expect(await db.select().from(applications)).toEqual([]);
    });

    it("checks a confirmed submission that a manual application beat", async () => {
      const { id, profileId, jobId } = await attempt();
      const run = rig();

      run.deps.repo = {
        ...repos.aiApply,
        submittedWithApplication: async (attemptId, record, at) => {
          await db.insert(applications).values({ profileId, jobId });

          return repos.aiApply.submittedWithApplication(attemptId, record, at);
        },
      };

      const logged = vi.spyOn(console, "error");

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "needs_check",
        screenshotKey: `ai-applications/${profileId}/${id}.png`,
      });
      expect([...run.objects.keys()]).toEqual([`ai-applications/${profileId}/${id}.png`]);
      expect(await db.select().from(applications)).toHaveLength(1);
      expect(logged).toHaveBeenCalledWith("AI application result lost", {
        name: "Error",
        message: "needs_check",
      });
    });

    it("keeps a confirmed submission when the screenshot fails", async () => {
      const { id } = await attempt();
      const run = rig({ page: { throwOn: "screenshot" } });
      const logged = vi.spyOn(console, "error");

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "submitted", screenshotKey: null });
      expect(logged).toHaveBeenCalledWith("AI application screenshot failed", {
        name: "Error",
        message: "boom at screenshot",
      });
    });
  });

  describe("never clicks twice after a crash", () => {
    it("checks an attempt left in submitting instead of opening a browser again", async () => {
      const { id } = await attempt();
      const run = rig();
      vi.spyOn(console, "error");

      const crashed = {
        ...run.deps,
        repo: {
          ...repos.aiApply,
          submittedWithApplication: async () => {
            throw new Error("connection lost");
          },
        },
      };

      await runAiApplication(crashed, id, now);

      expect((await stateOf(id)).state).toBe("submitting");

      expect(await runAiApplication(run.deps, id, later)).toEqual({ skipped: true });
      expect(await runAiApplication(run.deps, id, later)).toEqual({ skipped: true });

      expect(await stateOf(id)).toMatchObject({ state: "needs_check", finishedAt: null });
      expect(run.created()).toBe(1);
      expect(run.submits()).toBe(1);
      expect(run.lifts()).toBe(1);
      expect(run.released).toEqual(["session-1"]);
      expect(await db.select().from(applications)).toEqual([]);
    });

    it("leaves a fresh submitting attempt to the run that owns it", async () => {
      const { id } = await attempt({ state: "submitting", updatedAt: clock });
      const run = rig();
      const edge = () => new Date(clock.getTime() + 15 * 60_000);

      expect(await runAiApplication(run.deps, id, now)).toEqual({ skipped: true });
      expect(await runAiApplication(run.deps, id, edge)).toEqual({ skipped: true });
      expect(await stateOf(id)).toMatchObject({ state: "submitting", updatedAt: clock });
      expect(run.created()).toBe(0);

      await runAiApplication(run.deps, id, later);

      expect(await stateOf(id)).toMatchObject({ state: "needs_check", finishedAt: null });
      expect(run.created()).toBe(0);
    });

    it("checks a submitting attempt that has no update time", async () => {
      const { id } = await attempt({ state: "submitting" });
      const run = rig();

      await db.update(aiApplications).set({ updatedAt: null }).where(eq(aiApplications.id, id));
      await runAiApplication(run.deps, id, now);

      expect((await stateOf(id)).state).toBe("needs_check");
      expect(run.created()).toBe(0);
    });

    it("never runs an attempt in any other state", async () => {
      for (const state of ["rehearsed", "needs_check", "cancelled"] as const) {
        await seedDatabase(db, testSeedFixtures);

        const { id } = await attempt();

        await db.update(aiApplications).set({ state }).where(eq(aiApplications.id, id));

        const run = rig();

        expect(await runAiApplication(run.deps, id, now)).toEqual({ skipped: true });
        expect((await stateOf(id)).state).toBe(state);
        expect(run.created()).toBe(0);
      }

      const run = rig();

      expect(await runAiApplication(run.deps, "not-a-uuid", now)).toEqual({ skipped: true });
      expect(await runAiApplication(run.deps, "00000000-0000-4000-8000-000000000009", now)).toEqual(
        { skipped: true },
      );

      expect(run.created()).toBe(0);
    });

    it("stops when the attempt is cancelled between loading and claiming it", async () => {
      const { id, profileId } = await attempt();
      const run = rig();

      run.deps.repo = {
        ...repos.aiApply,
        runnable: async (attemptId) => {
          const loaded = await repos.aiApply.runnable(attemptId);

          await repos.aiApply.cancel(profileId, attemptId, new Date());

          return loaded;
        },
      };

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "cancelled",
        reason: "cancelled_by_person",
      });
      expect(run.created()).toBe(0);
    });

    it("resumes an attempt a crash left running, since nothing was clicked", async () => {
      const { id } = await attempt({
        state: "running",
        updatedAt: new Date(clock.getTime() - 6 * 60_000),
      });

      const run = rig();

      expect(await runAiApplication(run.deps, id, now)).toBeUndefined();
      expect((await stateOf(id)).state).toBe("submitted");
      expect(run.submits()).toBe(1);
    });

    it("never takes over a run that is still live", async () => {
      const { id } = await attempt({ state: "running" });
      const run = rig();

      expect(await runAiApplication(run.deps, id, now)).toEqual({ skipped: true });
      expect((await stateOf(id)).state).toBe("running");
      expect(run.created()).toBe(0);
    });

    it("clicks once when two runs race to the submit step", async () => {
      const { id } = await attempt();
      const first = rig();
      const second = rig();
      let arrived = 0;
      let open = () => {};

      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });

      const racing = {
        ...repos.aiApply,
        claimForRun: async (attemptId: string, at: Date) => {
          await repos.aiApply.claimForRun(attemptId, at);

          return true;
        },
        markSubmitting: async (attemptId: string, at: Date) => {
          arrived += 1;

          if (arrived === 2) open();

          await gate;

          return repos.aiApply.markSubmitting(attemptId, at);
        },
      };

      await Promise.all([
        runAiApplication({ ...first.deps, repo: racing }, id, now),
        runAiApplication({ ...second.deps, repo: racing }, id, now),
      ]);

      expect(arrived).toBe(2);
      expect(first.submits() + second.submits()).toBe(1);
      expect([...first.released, ...second.released]).toEqual(["session-1", "session-1"]);
      expect((await stateOf(id)).state).toBe("submitted");
      expect(await db.select().from(applications)).toHaveLength(1);
    });

    it("stops without a click when consent is withdrawn during the fill", async () => {
      const { id, profileId } = await attempt();

      const run = rig({
        page: {
          duringFill: async () => {
            await db
              .update(talentProfiles)
              .set({ aiApplyConsentAt: null })
              .where(eq(talentProfiles.id, profileId));
          },
        },
      });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "cancelled", reason: "consent_withdrawn" });
      expect(run.submits()).toBe(0);
      expect(run.released).toEqual(["session-1"]);
    });

    it("leaves an attempt cancelled or deleted during the fill alone, without a click", async () => {
      const { id } = await attempt();

      const cancelled = rig({
        page: {
          duringFill: async () => {
            await db
              .update(aiApplications)
              .set({ state: "cancelled", reason: "cancelled_by_person" })
              .where(eq(aiApplications.id, id));
          },
        },
      });

      await runAiApplication(cancelled.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "cancelled",
        reason: "cancelled_by_person",
      });
      expect(cancelled.submits()).toBe(0);

      await seedDatabase(db, testSeedFixtures);

      const other = await attempt();

      const deleted = rig({
        page: {
          duringFill: async () => {
            await db.delete(aiApplications).where(eq(aiApplications.id, other.id));
          },
        },
      });

      await runAiApplication(deleted.deps, other.id, now);

      expect(deleted.submits()).toBe(0);
      expect(deleted.released).toEqual(["session-1"]);
    });

    it("stops before a browser when the résumé or the cover letter changed after confirm", async () => {
      const { id, resumeId } = await attempt();

      await db
        .update(resumes)
        .set({ updatedAt: new Date(Date.now() + 60_000) })
        .where(eq(resumes.id, resumeId));

      const run = rig();

      expect(await runAiApplication(run.deps, id, now)).toEqual({ skipped: true });
      expect(await stateOf(id)).toMatchObject({ state: "assisted", reason: "files_changed" });
      expect(run.created()).toBe(0);

      await seedDatabase(db, testSeedFixtures);

      const lettered = await attempt({ letter: "Olá." });

      await db
        .update(applicationPackages)
        .set({ updatedAt: new Date(Date.now() + 60_000) })
        .where(eq(applicationPackages.profileId, lettered.profileId));

      await runAiApplication(run.deps, lettered.id, now);

      expect(await stateOf(lettered.id)).toMatchObject({
        state: "assisted",
        reason: "files_changed",
      });
      expect(run.created()).toBe(0);
    });

    it("stops before a browser when the share settings changed after confirm", async () => {
      const { id, profileId } = await attempt();

      await db.insert(talentPreferences).values({
        profileId,
        createdAt: earlier(),
        updatedAt: new Date(Date.now() + 60_000),
      });

      const run = rig();

      expect(await runAiApplication(run.deps, id, now)).toEqual({ skipped: true });
      expect(await stateOf(id)).toMatchObject({ state: "assisted", reason: "files_changed" });
      expect(run.created()).toBe(0);

      await seedDatabase(db, testSeedFixtures);

      const unchanged = await attempt();

      await db
        .insert(talentPreferences)
        .values({ profileId: unchanged.profileId, createdAt: earlier(), updatedAt: earlier() });

      await runAiApplication(run.deps, unchanged.id, now);

      expect((await stateOf(unchanged.id)).state).toBe("submitted");
    });

    it("hands a foreign phone number back before a browser", async () => {
      const phone = question("phone", "Telefone", "phone", [text("phone")]);
      const questions = [...baseQuestions, phone];

      const { id } = await attempt({
        questions,
        confirmed: [...baseConfirmed, { questionId: "phone", value: "+1 415 555 0100" }],
      });

      const run = rig({ page: { questions } });

      expect(await runAiApplication(run.deps, id, now)).toEqual({ skipped: true });
      expect(await stateOf(id)).toMatchObject({
        state: "assisted",
        reason: "form_changed",
        finishedAt: clock,
      });
      expect(run.created()).toBe(0);

      await seedDatabase(db, testSeedFixtures);

      const brazilian = await attempt({
        questions,
        confirmed: [...baseConfirmed, { questionId: "phone", value: "+55 11 97777-6666" }],
      });

      await runAiApplication(run.deps, brazilian.id, now);

      expect(run.created()).toBe(1);
    });

    it("stops at the run deadline before uploading", async () => {
      const { id } = await attempt();
      const run = rig({ deps: { budgetMs: 0 } });
      const logged = vi.spyOn(console, "error");

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "assisted", reason: "error" });
      expect(run.uploads).toEqual([]);
      expect(run.released).toEqual(["session-1"]);
      expect(logged).toHaveBeenCalledWith("AI application run failed", {
        name: "Error",
        message: "Run budget exceeded",
      });
    });

    it("stops without a click when a manual application lands during the fill", async () => {
      const { id, profileId, jobId } = await attempt();

      const run = rig({
        page: {
          duringFill: async () => {
            await db.insert(applications).values({ profileId, jobId });
          },
        },
      });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "cancelled", reason: "applied_manually" });
      expect(run.submits()).toBe(0);
      expect(run.released).toEqual(["session-1"]);
    });

    it("refuses to click without time left to see the outcome", async () => {
      const { id } = await attempt();
      const run = rig({ deps: { budgetMs: 40_000 } });
      const logged = vi.spyOn(console, "error");

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "assisted", reason: "error" });
      expect(run.submits()).toBe(0);
      expect(logged).toHaveBeenCalledWith("AI application run failed", {
        name: "Error",
        message: "Run budget exceeded",
      });
    });
  });

  describe("always releases the session", () => {
    const cases = [
      [{ page: { throwOn: "navigate" } }, { state: "assisted", reason: "error" }],
      [{ page: { throwOn: "type" } }, { state: "assisted", reason: "error" }],
      [{ page: { throwOn: "submit" } }, { state: "needs_check", reason: null }],
      [{ page: { throwOn: "url" } }, { state: "submitted", evidence: { finalUrl: null } }],
      [{ page: { throwOn: "close" } }, { state: "submitted" }],
      [{ browserbase: { failUpload: true } }, { state: "assisted", reason: "upload_failed" }],
      [{ browserbase: { failRelease: true } }, { state: "submitted" }],
      [{ failConnect: true }, { state: "assisted", reason: "error" }],
    ] satisfies [Rig, Partial<{ state: string; reason: string | null; evidence: object }>][];

    for (const [setup, expected] of cases) {
      it(`releases after ${JSON.stringify(setup)}`, async () => {
        const { id } = await attempt();
        const run = rig(setup);
        vi.spyOn(console, "error");

        await expect(runAiApplication(run.deps, id, now)).resolves.toBeUndefined();

        expect(await stateOf(id)).toMatchObject(expected);
        expect(run.released).toEqual(["session-1"]);
      });
    }

    it("releases after a rehearsal screenshot fails", async () => {
      const { id } = await attempt({ rehearsal: true });
      const run = rig({ page: { throwOn: "screenshot" } });
      vi.spyOn(console, "error");

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({ state: "assisted", reason: "error" });
      expect(run.released).toEqual(["session-1"]);
    });

    it("needs no release when no session was created", async () => {
      const { id } = await attempt();
      const run = rig({ browserbase: { failCreate: 503 } });
      const logged = vi.spyOn(console, "error");

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "assisted",
        reason: "error",
        evidence: { fields: [], files: [], finalUrl: null },
      });
      expect(run.released).toEqual([]);
      expect(run.opened).toEqual([]);
      expect(logged).toHaveBeenCalledWith("AI application run failed", {
        name: "BrowserbaseError",
        message: "Browserbase create session failed with status 503",
      });
    });

    for (const status of [429, 402]) {
      it(`queues the attempt again when Browserbase answers ${status}`, async () => {
        const { id } = await attempt();
        const run = rig({ browserbase: { failCreate: status } });

        expect(await runAiApplication(run.deps, id, now)).toEqual({
          postponeUntil: new Date(clock.getTime() + 5 * 60_000),
        });

        expect(await stateOf(id)).toMatchObject({
          state: "queued",
          reason: null,
          finishedAt: null,
          updatedAt: clock,
        });
        expect(run.created()).toBe(1);
        expect(run.opened).toEqual([]);
        expect(run.released).toEqual([]);

        expect(await runAiApplication(rig().deps, id, now)).toBeUndefined();
        expect((await stateOf(id)).state).toBe("submitted");
      });
    }

    it("logs a failed save without the evidence it carried", async () => {
      const { id } = await attempt();
      const run = rig({ page: { outcome: "blocked" } });
      const logged = vi.spyOn(console, "error");

      run.deps.repo = {
        ...repos.aiApply,
        finish: (attemptId, from, outcome, at) =>
          repos.aiApply.finish(attemptId, from, { ...outcome, reason: "x".repeat(80) }, at),
      };

      await runAiApplication(run.deps, id, now);

      expect(logged).toHaveBeenCalledWith("AI application result not saved", {
        name: "Error",
        code: "22001",
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("Gosto de pagamentos.");
      expect(JSON.stringify(logged.mock.calls)).not.toContain(email);
      expect((await stateOf(id)).state).toBe("submitting");
      expect(run.released).toEqual(["session-1"]);
    });

    it("never throws when the result cannot be saved", async () => {
      const { id } = await attempt();
      const run = rig({ page: { outcome: "timeout" } });
      const logged = vi.spyOn(console, "error");

      run.deps.repo = {
        ...repos.aiApply,
        finish: async () => {
          throw new Error("connection lost");
        },
      };

      await expect(runAiApplication(run.deps, id, now)).resolves.toBeUndefined();

      expect(run.released).toEqual(["session-1"]);
      expect(run.stored).toHaveLength(1);
      expect(run.objects.size).toBe(0);
      expect(logged).toHaveBeenCalledWith("AI application result not saved", { name: "Error" });
    });
  });

  describe("never leaves an orphan screenshot", () => {
    it("removes the screenshot when the account is deleted during a rehearsal fill", async () => {
      const { id, profileId } = await attempt({ rehearsal: true });

      const run = rig({
        page: {
          duringFill: async () => {
            await run.storage.removePrefix(`ai-applications/${profileId}/`);
            expect(await repos.account.deleteProfile(profileId)).toBe(true);
          },
        },
      });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toBeUndefined();
      expect(run.stored.map((object) => object.key)).toEqual([
        `ai-applications/${profileId}/${id}.png`,
      ]);
      expect(run.objects.size).toBe(0);
      expect(run.released).toEqual(["session-1"]);
    });

    it("removes the screenshot when a manual application cancels a running rehearsal", async () => {
      const { id, profileId, jobId, resumeId } = await attempt({ rehearsal: true });

      const run = rig({
        page: {
          duringFill: async () => {
            expect(await repos.applications.apply(profileId, jobId, resumeId)).toMatchObject({
              applicationId: expect.any(String),
            });
          },
        },
      });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "cancelled",
        reason: "applied_manually",
        screenshotKey: null,
        evidence: null,
      });
      expect(run.stored).toHaveLength(1);
      expect(run.objects.size).toBe(0);
    });

    it("cancels a running rehearsal on withdrawn consent and removes its screenshot", async () => {
      const { id, profileId } = await attempt({ rehearsal: true });

      const run = rig({
        page: {
          duringFill: async () => {
            await repos.talent.setAiApplyConsent(profileId, false, new Date());
          },
        },
      });

      await runAiApplication(run.deps, id, now);

      expect(await stateOf(id)).toMatchObject({
        state: "cancelled",
        reason: "consent_withdrawn",
        screenshotKey: null,
      });
      expect(run.stored).toHaveLength(1);
      expect(run.objects.size).toBe(0);
    });

    it("logs a screenshot it could not remove by name and code only", async () => {
      const { id, profileId } = await attempt({ rehearsal: true });
      const logged = vi.spyOn(console, "error");

      const run = rig({
        storage: { failRemove: true },
        page: {
          duringFill: async () => {
            await repos.account.deleteProfile(profileId);
          },
        },
      });

      await expect(runAiApplication(run.deps, id, now)).resolves.toBeUndefined();

      expect(logged).toHaveBeenCalledWith("AI application screenshot not removed", {
        name: "Error",
        code: "EACCES",
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain(profileId);
      expect(run.released).toEqual(["session-1"]);
    });
  });

  describe("re-checks the gate before opening a browser", () => {
    const cases = [
      [
        "withdrawn consent",
        async (setup: { profileId: string }) => {
          await db
            .update(talentProfiles)
            .set({ aiApplyConsentAt: null })
            .where(eq(talentProfiles.id, setup.profileId));
        },
        {},
        { state: "cancelled", reason: "consent_withdrawn" },
      ],
      [
        "a company that dropped from the top plan",
        async () => {
          await onPlan("gold");
        },
        {},
        { state: "cancelled", reason: "not_allowed" },
      ],
      [
        "a canceled top-plan subscription",
        async () => {
          await onPlan("platinum-premium", "canceled");
        },
        {},
        { state: "cancelled", reason: "not_allowed" },
      ],
      [
        "a manual application",
        async (setup: { profileId: string; jobId: string }) => {
          await db.insert(applications).values({ profileId: setup.profileId, jobId: setup.jobId });
        },
        {},
        { state: "cancelled", reason: "applied_manually" },
      ],
      [
        "a closed job",
        async (setup: { jobId: string }) => {
          await db.update(jobs).set({ closedAt: new Date() }).where(eq(jobs.id, setup.jobId));
        },
        {},
        { state: "assisted", reason: "job_closed" },
      ],
      [
        "Browserbase not configured",
        async () => undefined,
        { browserbase: undefined },
        { state: "assisted", reason: "error" },
      ],
      [
        "an unreadable job key",
        async (setup: { jobId: string }) => {
          await db.update(jobs).set({ sourceKey: "acme" }).where(eq(jobs.id, setup.jobId));
        },
        {},
        { state: "assisted", reason: "error" },
      ],
      [
        "a deleted résumé",
        async (setup: { resumeId: string }) => {
          await db.delete(resumes).where(eq(resumes.id, setup.resumeId));
        },
        {},
        { state: "assisted", reason: "error" },
      ],
    ] satisfies [
      string,
      (setup: { profileId: string; jobId: string; resumeId: string }) => Promise<void>,
      Partial<RunnerDeps>,
      { state: string; reason: string },
    ][];

    for (const [name, change, deps, expected] of cases) {
      it(`stops on ${name}`, async () => {
        const created = await attempt();
        const run = rig({ deps });
        vi.spyOn(console, "error");

        await change(created);

        expect(await runAiApplication(run.deps, created.id, now)).toEqual({ skipped: true });

        expect(await stateOf(created.id)).toMatchObject({ ...expected, finishedAt: clock });
        expect(run.created()).toBe(0);
        expect(run.opened).toEqual([]);
      });
    }
  });
});
