import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { applications, jobs, talentProfiles } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createInsightsRepository } from "./repository.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const empty = {
  enabled: 0,
  activated: null,
  funnel: { sent: null, responded: null, interviews: null, offers: null },
  hiresShared: null,
  topJobs: [],
  sharedJobs: [],
};

describe.skipIf(!url)("insights repository", () => {
  const db = createClient(url ?? "");
  const repository = createInsightsRepository(db);

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

  let sequence = 0;

  async function person(values: Partial<typeof talentProfiles.$inferInsert> = {}) {
    sequence += 1;

    const [row] = await db
      .insert(talentProfiles)
      .values({
        name: `Pessoa ${sequence}`,
        personalEmail: `pessoa${sequence}@example.com`,
        sponsoredUntil: "2099-12-31",
        ...values,
      })
      .returning({ id: talentProfiles.id });

    return row.id;
  }

  async function people(total: number, values: Partial<typeof talentProfiles.$inferInsert> = {}) {
    const ids: string[] = [];

    for (let index = 0; index < total; index += 1) ids.push(await person(values));

    return ids;
  }

  async function job(title: string, values: Partial<typeof jobs.$inferInsert> = {}) {
    sequence += 1;

    const [row] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "seed",
        sourceKey: `${title}-${sequence}`,
        title,
        company: "Acme",
        url: `https://jobs.example.com/${sequence}`,
        ...values,
      })
      .returning({ id: jobs.id });

    return row.id;
  }

  type Stage = "sent" | "in_review" | "interview" | "offer";

  function apply(profileId: string, jobId: string, stage: Stage = "sent") {
    return db
      .insert(applications)
      .values({ profileId, jobId, status: stage, furthestStage: stage });
  }

  function close(
    profileId: string,
    jobId: string,
    closedReason: "rejected" | "withdrawn" | "hired",
    furthestStage: Stage,
  ) {
    return db
      .insert(applications)
      .values({ profileId, jobId, status: "closed", furthestStage, closedReason });
  }

  it("returns suppressed figures when nobody was offboarded", async () => {
    expect(await repository.aggregates()).toEqual(empty);
  });

  it("suppresses figures from fewer than five people", async () => {
    const four = await people(4);
    const analista = await job("Analista");
    const designer = await job("Designer");
    const engenheira = await job("Engenheira");

    for (const id of four) {
      for (const jobId of [analista, designer, engenheira]) await apply(id, jobId, "offer");
    }

    expect(await repository.aggregates()).toEqual({ ...empty, enabled: 4 });

    const fifth = await person();
    const sixth = await person();

    await apply(fifth, analista, "offer");
    await apply(fifth, designer);
    await apply(sixth, designer);

    expect(await repository.aggregates()).toEqual({
      ...empty,
      enabled: 6,
      funnel: { sent: 15, responded: 13, interviews: 13, offers: 13 },
      topJobs: [
        { title: "Designer", company: "Acme", applications: 6 },
        { title: "Analista", company: "Acme", applications: 5 },
      ],
    });
  });

  it("classifies the funnel by furthest stage and closing reason", async () => {
    const five = await people(5);

    const [open, rejected, withdrawn, review, interview] = await Promise.all(
      ["Aberta", "Recusada", "Desistência", "Triagem", "Entrevista"].map((title) => job(title)),
    );

    for (const id of five) {
      await apply(id, open);
      await close(id, rejected, "rejected", "sent");
      await close(id, withdrawn, "withdrawn", "sent");
      await apply(id, review, "in_review");
      await close(id, interview, "withdrawn", "interview");
    }

    const result = await repository.aggregates();

    expect(result.funnel).toEqual({ sent: 25, responded: 15, interviews: 5, offers: null });
    expect(result.topJobs).toEqual(
      ["Aberta", "Desistência", "Entrevista", "Recusada", "Triagem"].map((title) => ({
        title,
        company: "Acme",
        applications: 5,
      })),
    );
  });

  it("ranks at most five jobs by applications, then title", async () => {
    const six = await people(6);
    const titles = ["Zeladora", "Contadora", "Analista", "Barista", "Designer", "Escritora"];

    for (const title of titles) {
      const jobId = await job(title, { company: `${title} SA` });
      const applicants = title === "Zeladora" ? six : six.slice(0, 5);

      for (const id of applicants) await apply(id, jobId);
    }

    expect((await repository.aggregates()).topJobs).toEqual([
      { title: "Zeladora", company: "Zeladora SA", applications: 6 },
      { title: "Analista", company: "Analista SA", applications: 5 },
      { title: "Barista", company: "Barista SA", applications: 5 },
      { title: "Contadora", company: "Contadora SA", applications: 5 },
      { title: "Designer", company: "Designer SA", applications: 5 },
    ]);
  });

  it("counts only consented hires", async () => {
    const consenting = await people(5, { shareOutcomeWithHr: true });
    const silent = await people(2);
    const first = await job("Analista");
    const second = await job("Designer");

    for (const id of [...consenting, ...silent]) await close(id, first, "hired", "offer");

    await close(consenting[0], second, "hired", "offer");
    await close(consenting[1], second, "rejected", "offer");

    expect((await repository.aggregates()).hiresShared).toBe(6);

    await db
      .update(talentProfiles)
      .set({ shareOutcomeWithHr: false })
      .where(eq(talentProfiles.id, consenting[4]));

    expect((await repository.aggregates()).hiresShared).toBeNull();

    await db
      .update(talentProfiles)
      .set({ shareOutcomeWithHr: true })
      .where(eq(talentProfiles.id, silent[0]));

    expect((await repository.aggregates()).hiresShared).toBe(6);
  });

  it("suppresses activation but never the number of people enabled", async () => {
    await people(4, { firstSignedInAt: new Date("2026-11-01T12:00:00Z") });
    await people(3);

    expect(await repository.aggregates()).toMatchObject({ enabled: 7, activated: null });

    await person({ firstSignedInAt: new Date("2026-11-02T12:00:00Z") });

    expect(await repository.aggregates()).toMatchObject({ enabled: 8, activated: 5 });
  });

  it("lists the five most recent jobs HR shared", async () => {
    await job("Externa", { postedAt: new Date("2026-11-20T12:00:00Z") });
    await job("Recrutadora", { origin: "recruiter", postedAt: new Date("2026-11-21T12:00:00Z") });
    await job("Antiga", { origin: "hr", postedAt: new Date("2026-10-01T12:00:00Z") });
    await job("Fechada", {
      origin: "hr",
      postedAt: new Date("2026-11-10T12:00:00Z"),
      closedAt: new Date("2026-11-15T12:00:00Z"),
    });
    await job("Recente", { origin: "hr", postedAt: new Date("2026-11-12T12:00:00Z") });
    await job("Sem data", {
      origin: "hr",
      postedAt: null,
      createdAt: new Date("2026-11-23T12:00:00Z"),
    });
    await job("Sem data antiga", {
      origin: "hr",
      postedAt: null,
      createdAt: new Date("2026-09-01T12:00:00Z"),
    });
    await job("Média", { origin: "hr", postedAt: new Date("2026-11-05T12:00:00Z") });

    expect((await repository.aggregates()).sharedJobs).toEqual([
      { title: "Recente", company: "Acme", sharedAt: "2026-11-12T12:00:00.000Z" },
      { title: "Fechada", company: "Acme", sharedAt: "2026-11-10T12:00:00.000Z" },
      { title: "Média", company: "Acme", sharedAt: "2026-11-05T12:00:00.000Z" },
      { title: "Antiga", company: "Acme", sharedAt: "2026-10-01T12:00:00.000Z" },
      { title: "Sem data", company: "Acme", sharedAt: "2026-11-23T12:00:00.000Z" },
    ]);
  });

  it("exposes no person-level data", async () => {
    const five = await people(5, {
      shareOutcomeWithHr: true,
      firstSignedInAt: new Date("2026-11-01T12:00:00Z"),
    });

    const hired = await job("Analista", { origin: "hr", postedAt: new Date() });

    for (const id of five) await close(id, hired, "hired", "offer");

    const result = await repository.aggregates();

    expect(Object.keys(result).sort()).toEqual([
      "activated",
      "enabled",
      "funnel",
      "hiresShared",
      "sharedJobs",
      "topJobs",
    ]);
    expect(Object.keys(result.funnel).sort()).toEqual([
      "interviews",
      "offers",
      "responded",
      "sent",
    ]);
    expect(result.topJobs.map((row) => Object.keys(row).sort())).toEqual([
      ["applications", "company", "title"],
    ]);
    expect(result.sharedJobs.map((row) => Object.keys(row).sort())).toEqual([
      ["company", "sharedAt", "title"],
    ]);

    const serialized = JSON.stringify(result);

    for (const id of [...five, hired]) expect(serialized).not.toContain(id);
    expect(serialized).not.toMatch(/Pessoa|@example\.com/);
  });
});
