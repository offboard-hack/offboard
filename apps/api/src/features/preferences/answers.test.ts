import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { answerQuestions, offboardingCases, talentAnswers } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const missingId = "00000000-0000-4000-8000-000000000001";
const identified = z.object({ id: z.uuid() });
const first = new Date("2026-11-24T10:00:00Z");
const second = new Date("2026-11-25T10:00:00Z");

describe.skipIf(!url)("answers repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const repository = repos.answers;
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

    const [one, two] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    profileId = await enable(one.id, "pessoa@exemplo.com");
    otherProfileId = await enable(two.id, "outra@exemplo.com");
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

  async function commonId(index = 0) {
    const { questions } = await repository.library(profileId);

    return questions[index].id;
  }

  it("lists the common questions unanswered, ordered by text", async () => {
    const library = await repository.library(profileId);

    expect(library.questions).toHaveLength(10);
    expect(library.unanswered).toBe(10);
    expect(library.questions.every((item) => item.common && item.answer === null)).toBe(true);

    expect(library.questions.map((item) => item.text)).toEqual([
      "Como você soube da vaga?",
      "Qual a sua disponibilidade para início?",
      "Qual a sua pretensão salarial?",
      "Qual o link do seu LinkedIn?",
      "Qual o seu aviso prévio?",
      "Qual o seu nível de inglês?",
      "Você aceita trabalhar no modelo presencial?",
      "Você possui CNH?",
      "Você se autodeclara pessoa com deficiência (PcD)?",
      "Você tem disponibilidade para viagens?",
    ]);
  });

  it("stores an answer, counts it and keeps the others unanswered", async () => {
    const id = await commonId();

    expect(await repository.answer(profileId, id, "  R$ 9.000  ", first)).toBe(true);

    const library = await repository.library(profileId);

    expect(library.unanswered).toBe(9);
    expect(library.questions.find((item) => item.id === id)?.answer).toBe("R$ 9.000");

    const [row] = await db.select().from(talentAnswers);

    expect(row).toMatchObject({ profileId, questionId: id, updatedAt: first });
  });

  it("replaces an answer and refreshes updatedAt", async () => {
    const id = await commonId();

    await repository.answer(profileId, id, "Primeira", first);
    await repository.answer(profileId, id, "Segunda", second);

    const rows = await db.select().from(talentAnswers);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ answer: "Segunda", updatedAt: second });
  });

  it("deletes the answer when it is empty after trimming", async () => {
    const id = await commonId();

    await repository.answer(profileId, id, "Algo", first);

    expect(await repository.answer(profileId, id, " \n\t ", second)).toBe(true);
    expect(await db.select().from(talentAnswers)).toEqual([]);
    expect((await repository.library(profileId)).unanswered).toBe(10);
  });

  it("treats an empty answer for a question never answered as success", async () => {
    expect(await repository.answer(profileId, await commonId(), "", first)).toBe(true);
    expect(await db.select().from(talentAnswers)).toEqual([]);
  });

  it("strips nul bytes and lone surrogates from the answer", async () => {
    const id = await commonId();

    await repository.answer(profileId, id, " a\u0000b\uD800c ", first);

    const [row] = await db.select().from(talentAnswers);

    expect(row.answer).toBe("ab�c");
  });

  it("reports unknown and malformed question ids", async () => {
    expect(await repository.answer(profileId, missingId, "x", first)).toBe(false);
    expect(await repository.answer(profileId, "not-a-uuid", "x", first)).toBe(false);
    expect(await repository.answer(profileId, missingId, "", first)).toBe(false);
    expect(await db.select().from(talentAnswers)).toEqual([]);
  });

  it("isolates answers between people", async () => {
    const id = await commonId();

    await repository.answer(profileId, id, "Minha", first);

    const other = await repository.library(otherProfileId);

    expect(other.unanswered).toBe(10);
    expect(other.questions.every((item) => item.answer === null)).toBe(true);

    await repository.answer(otherProfileId, id, "", second);

    expect((await repository.library(profileId)).unanswered).toBe(9);
  });

  it("collapses questions that differ only by case, accents, spacing and punctuation", async () => {
    const one = await repository.ensureQuestion("Qual sua pretensão salarial?", first);
    const two = await repository.ensureQuestion("  qual sua PRETENSAO salarial ", first);

    expect(two).toBe(one);
    expect(
      await db.select().from(answerQuestions).where(eq(answerQuestions.id, one)),
    ).toMatchObject([{ createdAt: first }]);
    expect(
      await db.select().from(answerQuestions).where(eq(answerQuestions.id, one)),
    ).toMatchObject([{ text: "Qual sua pretensão salarial?", common: false }]);
  });

  it("returns the existing common question without changing it", async () => {
    const id = await commonId();
    const [before] = await db.select().from(answerQuestions).where(eq(answerQuestions.id, id));

    expect(await repository.ensureQuestion(before.text.toUpperCase(), first)).toBe(id);
    expect(await db.select().from(answerQuestions).where(eq(answerQuestions.id, id))).toEqual([
      before,
    ]);
  });

  it("lists a collected question only for the person who answered it", async () => {
    const id = await repository.ensureQuestion("Qual seu time favorito?", first);

    expect((await repository.library(profileId)).questions).toHaveLength(10);

    await repository.answer(profileId, id, "Nenhum", first);

    const library = await repository.library(profileId);

    expect(library.questions).toHaveLength(11);
    expect(library.questions.at(-1)).toEqual({
      id,
      text: "Qual seu time favorito?",
      common: false,
      answer: "Nenhum",
    });
    expect(library.unanswered).toBe(10);
    expect((await repository.library(otherProfileId)).questions).toHaveLength(10);
  });

  it("orders common questions first, then by text", async () => {
    const early = await repository.ensureQuestion("Aaa primeira?", first);
    const late = await repository.ensureQuestion("Zzz última?", first);

    await repository.answer(profileId, late, "z", first);
    await repository.answer(profileId, early, "a", first);

    const { questions } = await repository.library(profileId);

    expect(questions.map((item) => item.common)).toEqual([...Array(10).fill(true), false, false]);
    expect(questions.slice(-2).map((item) => item.id)).toEqual([early, late]);
  });

  it("rejects empty, blank-after-normalizing and oversized questions", async () => {
    await expect(repository.ensureQuestion("   ", first)).rejects.toThrow("Invalid question");
    await expect(repository.ensureQuestion("???", first)).rejects.toThrow("Invalid question");
    await expect(repository.ensureQuestion("a".repeat(501), first)).rejects.toThrow(
      "Invalid question",
    );
    await expect(repository.ensureQuestion(`  ${"a".repeat(500)}  `, first)).resolves.toEqual(
      expect.any(String),
    );
  });
});
