import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  applicationEvents,
  applications,
  jobs,
  offboardingCases,
  resumes,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRepositories } from "../../repositories.js";
import type { ResumeContent } from "./content.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const missingId = "00000000-0000-4000-8000-000000000001";

const identified = z.object({ id: z.uuid() });

const created = z.object({ applicationId: z.uuid() });

function content(headline: string) {
  return {
    headline: { id: "headline", text: headline },
    summary: { id: "summary", text: "Dez anos de backend." },
    experiences: [],
    education: [],
    skills: [{ id: "skill", name: "TypeScript" }],
    languages: [],
    contact: { email: "ana@example.com", phone: null, city: null, links: [] },
  } satisfies ResumeContent;
}

const at = (iso: string) => new Date(iso);

describe.skipIf(!url)("résumé versions repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const repository = repos.resumeVersions;
  let profileId: string;
  let otherProfileId: string;

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);

    const [first, second] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    profileId = await enable(first.id, "pessoa@exemplo.com");
    otherProfileId = await enable(second.id, "outra@exemplo.com");
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function enable(caseId: string, personalEmail: string) {
    const profile = await repos.talent.enable({
      caseId,
      personalEmail,
      sponsoredUntil: "2026-12-31",
    });

    return identified.parse(profile).id;
  }

  async function job(sourceKey: string, values: Partial<typeof jobs.$inferInsert> = {}) {
    const [row] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "seed",
        sourceKey,
        title: `Vaga ${sourceKey}`,
        company: "Acme",
        url: `https://jobs.example.com/${sourceKey}`,
        description: `Descrição ${sourceKey}`,
        ...values,
      })
      .returning({ id: jobs.id });

    return row.id;
  }

  async function draft(owner: string, jobId: string, headline: string, now: Date) {
    const saved = await repository.saveDraft(owner, jobId, content(headline), 70, now);

    return identified.parse(saved).id;
  }

  async function base(owner: string) {
    const { resume } = await repos.resumes.replaceBase(owner, content("Base"), "resumes/base.pdf");

    return resume.id;
  }

  function stored(id: string) {
    return db
      .select({
        kind: resumes.kind,
        status: resumes.status,
        content: resumes.content,
        matchScore: resumes.matchScore,
        score: resumes.score,
        scoredAt: resumes.scoredAt,
        updatedAt: resumes.updatedAt,
      })
      .from(resumes)
      .where(eq(resumes.id, id));
  }

  it("finds open jobs for tailoring", async () => {
    const openId = await job("aberta", { workModel: "hybrid", city: "Campinas", state: "SP" });
    const closedId = await job("fechada", { closedAt: at("2026-11-01T00:00:00Z") });

    expect(await repository.jobForTailoring(openId)).toEqual({
      id: openId,
      title: "Vaga aberta",
      company: "Acme",
      workModel: "hybrid",
      city: "Campinas",
      state: "SP",
      description: "Descrição aberta",
    });
    expect(await repository.jobForTailoring(closedId)).toBeUndefined();
    expect(await repository.jobForTailoring(missingId)).toBeUndefined();
  });

  it("creates then replaces the draft for a job keeping its id", async () => {
    const jobId = await job("backend");

    const first = await repository.saveDraft(
      profileId,
      jobId,
      content("Primeira"),
      70,
      at("2026-11-20T10:00:00Z"),
    );

    expect(first).toEqual({
      id: expect.any(String),
      job: { id: jobId, title: "Vaga backend", company: "Acme" },
      status: "draft",
      matchScore: 70,
      content: content("Primeira"),
      application: null,
      updatedAt: "2026-11-20T10:00:00.000Z",
    });

    const { id } = identified.parse(first);

    await repository.markReady(profileId, id, at("2026-11-20T11:00:00Z"));

    const second = await repository.saveDraft(
      profileId,
      jobId,
      content("Segunda"),
      null,
      at("2026-11-21T10:00:00Z"),
    );

    expect(second).toEqual({
      id,
      job: { id: jobId, title: "Vaga backend", company: "Acme" },
      status: "draft",
      matchScore: null,
      content: content("Segunda"),
      application: null,
      updatedAt: "2026-11-21T10:00:00.000Z",
    });
    expect(await stored(id)).toEqual([
      {
        kind: "tailored",
        status: "draft",
        content: content("Segunda"),
        matchScore: null,
        score: null,
        scoredAt: null,
        updatedAt: at("2026-11-21T10:00:00Z"),
      },
    ]);
    expect(await db.select().from(resumes)).toHaveLength(1);
  });

  it("waits for the profile and job advisory lock before saving a draft", async () => {
    const jobId = await job("trava");
    const holder = await db.$client.connect();

    const waiting = async () => {
      const result = await db.execute(
        sql`select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted`,
      );

      return z.array(z.object({ waiting: z.number() })).parse(result.rows)[0].waiting;
    };

    try {
      await holder.query("begin");
      await holder.query(
        "select pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))",
        [profileId, jobId],
      );

      const saving = repository.saveDraft(
        profileId,
        jobId,
        content("Travada"),
        70,
        at("2026-11-20T10:00:00Z"),
      );

      await vi.waitFor(async () => expect(await waiting()).toBe(1));
      expect(await db.select().from(resumes)).toEqual([]);

      await holder.query("commit");

      expect(await saving).toMatchObject({ status: "draft", content: content("Travada") });
    } finally {
      await holder.query("rollback");
      holder.release();
    }
  });

  it("keeps one version per profile and job", async () => {
    const jobId = await job("compartilhada");

    const own = await draft(profileId, jobId, "Minha", at("2026-11-20T10:00:00Z"));
    const other = await draft(otherProfileId, jobId, "Outra", at("2026-11-20T10:00:00Z"));

    expect(own).not.toBe(other);
    expect(await stored(other)).toEqual([expect.objectContaining({ content: content("Outra") })]);
  });

  it("refuses to replace a version used by an application", async () => {
    const jobId = await job("usada");
    const id = await draft(profileId, jobId, "Usada", at("2026-11-20T10:00:00Z"));

    await repository.markReady(profileId, id, at("2026-11-20T11:00:00Z"));
    created.parse(await repos.applications.apply(profileId, jobId, id));

    const before = await stored(id);

    expect(
      await repository.saveDraft(profileId, jobId, content("Nova"), 99, at("2026-11-22T10:00:00Z")),
    ).toBe("used");
    expect(
      await repository.update(profileId, id, content("Nova"), at("2026-11-22T10:00:00Z")),
    ).toBe("used");
    expect(await stored(id)).toEqual(before);
    expect(before).toEqual([
      expect.objectContaining({ status: "ready", content: content("Usada"), matchScore: 70 }),
    ]);
  });

  it("tells whether the profile already applied to a job with any résumé", async () => {
    const tailoredJob = await job("com-versao");
    const baseJob = await job("com-base");
    const freeJob = await job("livre");
    const id = await draft(profileId, tailoredJob, "Usada", at("2026-11-20T10:00:00Z"));

    await repository.markReady(profileId, id, at("2026-11-20T11:00:00Z"));
    created.parse(await repos.applications.apply(profileId, tailoredJob, id));
    created.parse(await repos.applications.apply(profileId, baseJob, await base(profileId)));

    expect(await repository.hasApplied(profileId, tailoredJob)).toBe(true);
    expect(await repository.hasApplied(profileId, baseJob)).toBe(true);
    expect(await repository.hasApplied(profileId, freeJob)).toBe(false);
    expect(await repository.hasApplied(otherProfileId, tailoredJob)).toBe(false);
  });

  it("lists the profile's tailored versions newest first with job and application", async () => {
    const olderJob = await job("antiga");
    const newerJob = await job("nova", { title: "Designer", company: "Globex" });

    await base(profileId);

    const older = await draft(profileId, olderJob, "Antiga", at("2026-11-20T10:00:00Z"));
    const newer = await draft(profileId, newerJob, "Nova", at("2026-11-21T10:00:00Z"));

    await draft(otherProfileId, olderJob, "Alheia", at("2026-11-22T10:00:00Z"));
    await repository.markReady(profileId, older, at("2026-11-20T11:00:00Z"));

    const { applicationId } = created.parse(
      await repos.applications.apply(profileId, olderJob, older),
    );

    await db
      .update(applications)
      .set({ appliedAt: at("2026-11-20T12:00:00Z") })
      .where(eq(applications.id, applicationId));

    const list = await repository.list(profileId);

    expect(list.map((version) => version.id)).toEqual([newer, older]);
    expect(list[0]).toMatchObject({
      job: { id: newerJob, title: "Designer", company: "Globex" },
      status: "draft",
      application: null,
    });
    expect(list[1]).toEqual({
      id: older,
      job: { id: olderJob, title: "Vaga antiga", company: "Acme" },
      status: "ready",
      matchScore: 70,
      content: content("Antiga"),
      application: { id: applicationId, status: "sent", appliedAt: "2026-11-20T12:00:00.000Z" },
      updatedAt: "2026-11-20T11:00:00.000Z",
    });
    expect(await repository.list(otherProfileId)).toHaveLength(1);
  });

  it("gets only the profile's own tailored versions", async () => {
    const jobId = await job("detalhe");
    const id = await draft(profileId, jobId, "Detalhe", at("2026-11-20T10:00:00Z"));
    const foreign = await draft(otherProfileId, jobId, "Alheia", at("2026-11-20T10:00:00Z"));
    const baseId = await base(profileId);

    expect(await repository.get(profileId, id)).toMatchObject({
      id,
      job: { id: jobId },
      content: content("Detalhe"),
    });
    expect(await repository.get(profileId, foreign)).toBeUndefined();
    expect(await repository.get(profileId, baseId)).toBeUndefined();
    expect(await repository.get(profileId, missingId)).toBeUndefined();
  });

  it("edits a version back to a draft", async () => {
    const jobId = await job("edicao");
    const id = await draft(profileId, jobId, "Antes", at("2026-11-20T10:00:00Z"));

    await repository.markReady(profileId, id, at("2026-11-20T11:00:00Z"));

    expect(
      await repository.update(profileId, id, content("Depois"), at("2026-11-21T10:00:00Z")),
    ).toMatchObject({
      id,
      status: "draft",
      matchScore: 70,
      content: content("Depois"),
      updatedAt: "2026-11-21T10:00:00.000Z",
    });
  });

  it("refuses to edit missing, base or other profiles' versions", async () => {
    const jobId = await job("alheia");
    const foreign = await draft(otherProfileId, jobId, "Alheia", at("2026-11-20T10:00:00Z"));
    const baseId = await base(profileId);
    const now = at("2026-11-21T10:00:00Z");

    for (const id of [foreign, baseId, missingId]) {
      expect(await repository.update(profileId, id, content("Invasão"), now)).toBe("not_found");
      expect(await repository.markReady(profileId, id, now)).toBe("not_found");
    }

    expect(await stored(foreign)).toEqual([
      expect.objectContaining({ status: "draft", content: content("Alheia") }),
    ]);
    expect(await stored(baseId)).toEqual([
      expect.objectContaining({ kind: "base", content: content("Base") }),
    ]);
  });

  it("marks a version ready, also when already used", async () => {
    const jobId = await job("pronta");
    const id = await draft(profileId, jobId, "Pronta", at("2026-11-20T10:00:00Z"));

    expect(await repository.markReady(profileId, id, at("2026-11-20T11:00:00Z"))).toMatchObject({
      id,
      status: "ready",
      content: content("Pronta"),
      updatedAt: "2026-11-20T11:00:00.000Z",
    });

    created.parse(await repos.applications.apply(profileId, jobId, id));

    expect(await repository.markReady(profileId, id, at("2026-11-21T11:00:00Z"))).toMatchObject({
      id,
      status: "ready",
      application: { status: "sent" },
      updatedAt: "2026-11-20T11:00:00.000Z",
    });
    expect(await stored(id)).toEqual([
      expect.objectContaining({ status: "ready", updatedAt: at("2026-11-20T11:00:00Z") }),
    ]);
  });

  it("never edits a version an application is being created with", async () => {
    const jobId = await job("corrida");
    const id = await draft(profileId, jobId, "Corrida", at("2026-11-20T10:00:00Z"));

    await repository.markReady(profileId, id, at("2026-11-20T11:00:00Z"));

    const warm = await Promise.all([db.$client.connect(), db.$client.connect()]);

    for (const client of warm) client.release();

    const [applied, edited] = await Promise.all([
      repos.applications.apply(profileId, jobId, id),
      repository.update(profileId, id, content("Editada"), at("2026-11-21T10:00:00Z")),
    ]);

    const outcome = { applied: applied !== "resume_not_ready", edited: edited !== "used" };

    expect([
      { applied: true, edited: false },
      { applied: false, edited: true },
    ]).toContainEqual(outcome);

    const [row] = await stored(id);

    expect(row.status === "ready").toBe(outcome.applied);
    expect(row.content.headline.text === "Corrida").toBe(outcome.applied);
    expect(await db.select().from(applications)).toHaveLength(Number(outcome.applied));
    expect(await db.select().from(applicationEvents)).toHaveLength(Number(outcome.applied));
  });
});
