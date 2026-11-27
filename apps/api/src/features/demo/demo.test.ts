import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { demoProfileEmbeddings, demoSearchUsage } from "@offboard/db/schema";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Embed } from "../../shared/embed.js";
import { demoProfiles } from "./profiles.js";
import { createDemoRepository } from "./repository.js";
import { type DemoProfile, demoRoutes } from "./routes.js";
import { syncDemoEmbeddings } from "./sync.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const keywords = ["Go", "Design", "Vendas"];

function vectorFor(text: string) {
  return Array.from({ length: 1024 }, (_, index) =>
    index < keywords.length && text.includes(keywords[index]) ? 1 : index === 1023 ? 0.01 : 0,
  );
}

function fakeEmbed() {
  const calls: string[][] = [];
  const state = { fail: false };

  const embed: Embed = async (texts) => {
    calls.push(texts);

    if (state.fail) throw new Error("embeddings down");

    return texts.map(vectorFor);
  };

  return { calls, state, embed };
}

function person(slug: string, headline: string, skills: string[]) {
  const profile: DemoProfile = {
    slug,
    name: `Pessoa ${slug}`,
    content: {
      headline: { text: headline },
      summary: { text: "" },
      experiences: [
        { role: headline, company: "Acme", start: "2020-01", end: null, bullets: [] },
        { role: "Estágio", company: "Beta", start: "2018", end: "2019-12", bullets: [] },
        { role: "Monitoria", company: "Gama", start: "2017", end: "2018", bullets: [] },
      ],
      education: [],
      skills: skills.map((name) => ({ name })),
      languages: [{ name: "Inglês", level: "Fluente" }],
      contact: { city: "Recife, PE" },
    },
  };

  return profile;
}

const catalog = [
  person("go", "Engenheira Go", ["Go", "Kubernetes"]),
  person("design", "Design de produto", ["Figma"]),
  person("vendas", "Vendas B2B", ["CRM"]),
];

describe("demo profiles", () => {
  it("ships unique slugs and complete public cards", () => {
    expect(demoProfiles.length).toBeGreaterThanOrEqual(40);
    expect(new Set(demoProfiles.map((profile) => profile.slug)).size).toBe(demoProfiles.length);

    for (const profile of demoProfiles) {
      expect(profile.content.contact.city).not.toBe("");
      expect(profile.content.experiences.length).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!url)("demo people search", () => {
  const db = createClient(url ?? "");
  const repo = createDemoRepository(db);

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await db.delete(demoProfileEmbeddings);
    await db.delete(demoSearchUsage);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  function search(app: ReturnType<typeof demoRoutes>, q: string, ip = "203.0.113.7") {
    return app.handle(
      new Request(`http://localhost/demo/search?q=${encodeURIComponent(q)}`, {
        headers: { "cf-connecting-ip": ip },
      }),
    );
  }

  it("embeds the catalog once, again only what changed, and drops removed profiles", async () => {
    const embedder = fakeEmbed();

    expect(await syncDemoEmbeddings(repo, embedder.embed, catalog)).toBe(3);
    expect(await syncDemoEmbeddings(repo, embedder.embed, catalog)).toBe(0);
    expect(embedder.calls).toHaveLength(1);

    const changed = [
      { ...catalog[0], content: { ...catalog[0].content, summary: { text: "Go" } } },
    ];

    expect(await syncDemoEmbeddings(repo, embedder.embed, changed)).toBe(1);
    expect((await repo.stored()).map((row) => row.slug)).toEqual(["go"]);
  });

  it("embeds a large catalog in batches of twenty", async () => {
    const embedder = fakeEmbed();
    const many = Array.from({ length: 21 }, (_, index) => person(`p${index}`, "Go", ["Go"]));

    expect(await syncDemoEmbeddings(repo, embedder.embed, many)).toBe(21);
    expect(embedder.calls.map((call) => call.length)).toEqual([20, 1]);
  });

  it("syncs the shipped catalog by default", async () => {
    const embedder = fakeEmbed();

    expect(await syncDemoEmbeddings(repo, embedder.embed)).toBe(demoProfiles.length);
  });

  it("returns the nearest profiles as public cards", async () => {
    const embedder = fakeEmbed();

    await syncDemoEmbeddings(repo, embedder.embed, catalog);
    await repo.save([{ slug: "gone", hash: "x", embedding: vectorFor("Go") }]);

    const res = await search(demoRoutes(repo, embedder.embed, catalog), "  dev Go  ");

    expect(res.status).toBe(200);

    const cards = await res.json();

    expect(cards[0]).toEqual({
      slug: "go",
      name: "Pessoa go",
      headline: "Engenheira Go",
      summary: "",
      city: "Recife, PE",
      match: expect.any(Number),
      experiences: [
        { role: "Engenheira Go", company: "Acme", start: "2020-01", end: null },
        { role: "Estágio", company: "Beta", start: "2018", end: "2019-12" },
      ],
      skills: ["Go", "Kubernetes"],
      languages: [{ name: "Inglês", level: "Fluente" }],
    });
    expect(cards[0].match).toBeGreaterThan(90);
    expect(cards.map((card: { slug: string }) => card.slug)).toEqual(["go", "design", "vendas"]);
    expect(embedder.calls.at(-1)).toEqual(["dev Go"]);
  });

  it("uses the shipped catalog by default", async () => {
    const embedder = fakeEmbed();

    await syncDemoEmbeddings(repo, embedder.embed);

    const cards = await (await search(demoRoutes(repo, embedder.embed), "Go")).json();

    expect(cards).toHaveLength(6);
  });

  it("caps searches per visitor and per day", async () => {
    const app = demoRoutes(repo, fakeEmbed().embed, catalog);

    for (let index = 0; index < 30; index += 1) {
      expect((await search(app, "Go")).status).toBe(200);
    }

    const capped = await search(app, "Go");

    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: "Too many searches" });
    expect((await search(app, "Go", "198.51.100.2")).status).toBe(200);

    await db
      .update(demoSearchUsage)
      .set({ searches: 2_000 })
      .where(eq(demoSearchUsage.bucket, "all"));

    expect((await search(app, "Go", "198.51.100.3")).status).toBe(429);

    const anonymous = await app.handle(new Request("http://localhost/demo/search?q=Go"));

    expect(anonymous.status).toBe(429);
  });

  it("answers 503 without embeddings, 502 when embedding fails and 422 for short queries", async () => {
    expect((await search(demoRoutes(repo, undefined, catalog), "Go")).status).toBe(503);

    const logged = vi.spyOn(console, "error");
    const embedder = fakeEmbed();

    embedder.state.fail = true;

    const failed = await search(demoRoutes(repo, embedder.embed, catalog), "Go");

    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "Search unavailable" });
    expect(logged.mock.calls).toContainEqual([
      "demo search embedding failed",
      { name: "Error", message: "embeddings down" },
    ]);
    logged.mockRestore();

    expect((await search(demoRoutes(repo, fakeEmbed().embed, catalog), "a")).status).toBe(422);
  });
});
