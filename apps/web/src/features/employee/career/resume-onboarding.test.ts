import { describe, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";
import {
  educationProblem,
  emptyDraft,
  emptyEducation,
  emptyExperience,
  experienceProblem,
  fileSize,
  isEmptyDraft,
  onboardingMachine,
  readingChecks,
  type ResumeDraft,
  sectionSummaries,
  splitLines,
  tooLong,
} from "./resume-onboarding";

const filled: ResumeDraft = {
  headline: { id: "h", text: "Engenheira de Software" },
  summary: { id: "s", text: "Backend em Go.\n\nLidera times.\nMentora." },
  experiences: [
    { id: "e1", company: "Acme", role: "Dev", start: "2019", end: null, bullets: [] },
    { id: "e2", company: "Beta", role: "", start: "2017", end: "2019", bullets: [] },
  ],
  education: [
    { id: "d1", institution: "UFPE", degree: "Ciência da Computação", start: null, end: null },
    { id: "d2", institution: "", degree: "MBA", start: null, end: null },
  ],
  skills: [
    { id: "k1", name: "Go" },
    { id: "k2", name: "SQL" },
  ],
  languages: [
    { id: "l1", name: "Inglês", level: "Fluente" },
    { id: "l2", name: "Espanhol", level: null },
  ],
  contact: {
    email: "maria@example.com",
    phone: null,
    city: "Recife",
    links: ["https://www.linkedin.com/in/maria"],
  },
};

const file = new File(["%PDF-1.4"], "curriculo.pdf", { type: "application/pdf" });

function start(deps: Partial<Parameters<typeof onboardingMachine>[0]> = {}) {
  const reads: File[] = [];
  const creates: { draft: ResumeDraft; file: File | null }[] = [];
  const created: true[] = [];

  const actor = createActor(
    onboardingMachine({
      read: async (chosen) => {
        reads.push(chosen);

        return filled;
      },
      create: async (input) => {
        creates.push(input);
      },
      onCreated: () => created.push(true),
      ...deps,
    }),
  ).start();

  return { actor, reads, creates, created };
}

describe("résumé onboarding content", () => {
  it("starts empty drafts and rows with fresh ids", () => {
    const draft = emptyDraft();

    expect(draft).toMatchObject({
      headline: { text: "" },
      experiences: [],
      contact: { email: null, links: [] },
    });
    expect(draft.headline.id).not.toBe(draft.summary.id);
    expect(isEmptyDraft(draft)).toBe(true);
    expect(isEmptyDraft(filled)).toBe(false);
    expect(isEmptyDraft({ ...draft, experiences: [emptyExperience()] })).toBe(false);
    expect(emptyExperience()).toMatchObject({ company: "", end: null, bullets: [] });
    expect(emptyEducation()).toMatchObject({ institution: "", start: null });
  });

  it("names what is missing in experiences and education", () => {
    const base = filled.experiences[0];

    expect(experienceProblem(base)).toBeUndefined();
    expect(experienceProblem({ ...base, role: " " })).toBe("Falta o cargo.");
    expect(experienceProblem({ ...base, company: "" })).toBe("Falta a empresa.");
    expect(experienceProblem({ ...base, start: "" })).toBe("Falta a data de início.");
    expect(educationProblem(filled.education[0])).toBeUndefined();
    expect(educationProblem(filled.education[1])).toBe("Falta a instituição.");
    expect(educationProblem({ ...filled.education[0], degree: "" })).toBe("Falta o curso.");
  });

  it("summarizes each section and counts what to check", () => {
    expect(sectionSummaries(filled)).toEqual([
      { id: "summary", title: "Resumo profissional", detail: "3 linhas", toCheck: 0 },
      { id: "experiences", title: "Experiências", detail: "2 cargos", toCheck: 1 },
      { id: "education", title: "Formação", detail: "2 cursos", toCheck: 1 },
      { id: "skills", title: "Competências", detail: "2 itens", toCheck: 0 },
      { id: "languages", title: "Idiomas", detail: "Inglês e espanhol", toCheck: 0 },
      {
        id: "contact",
        title: "Contato e links",
        detail: "E-mail, cidade e LinkedIn",
        toCheck: 0,
      },
    ]);
  });

  it("summarizes a sparse résumé", () => {
    const sparse: ResumeDraft = {
      ...emptyDraft(),
      summary: { id: "s", text: "Uma linha" },
      experiences: [filled.experiences[0]],
      education: [filled.education[0]],
      skills: [filled.skills[0]],
      languages: [filled.languages[0]],
      contact: { email: null, phone: "81 99999-0000", city: null, links: ["https://maria.dev"] },
    };

    expect(sectionSummaries(sparse).map((section) => section.detail)).toEqual([
      "1 linha",
      "1 cargo",
      "1 curso",
      "1 item",
      "Inglês",
      "Telefone e links",
    ]);
    expect(
      sectionSummaries(emptyDraft()).map((section) => [section.detail, section.toCheck]),
    ).toEqual([
      ["Vazio", 1],
      ["Nenhuma", 0],
      ["Nenhuma", 0],
      ["Nenhuma", 0],
      ["Nenhum", 0],
      ["Nada encontrado", 0],
    ]);
  });

  it("lists what the reading found", () => {
    expect(readingChecks(filled)).toEqual([
      { label: "Contato", found: true },
      { label: "Experiências · 2", found: true },
      { label: "Formação · 2", found: true },
      { label: "Competências · 2", found: true },
    ]);
    expect(readingChecks(emptyDraft()).map((check) => check.found)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(readingChecks(null)).toEqual([
      { label: "Contato", found: null },
      { label: "Experiências", found: null },
      { label: "Formação", found: null },
      { label: "Competências", found: null },
    ]);
    expect(
      readingChecks({
        ...emptyDraft(),
        contact: { ...filled.contact, email: null, city: null, links: [] },
      })[0],
    ).toEqual({ label: "Contato", found: false });
    expect(
      readingChecks({
        ...emptyDraft(),
        contact: { email: null, phone: "1", city: null, links: [] },
      })[0].found,
    ).toBe(true);
    expect(
      readingChecks({
        ...emptyDraft(),
        contact: { email: null, phone: null, city: "Recife", links: [] },
      })[0].found,
    ).toBe(true);
    expect(
      readingChecks({
        ...emptyDraft(),
        contact: { email: null, phone: null, city: null, links: ["x"] },
      })[0].found,
    ).toBe(true);
  });

  it("formats sizes, lines and limits", () => {
    expect(fileSize(900)).toBe("900 B");
    expect(fileSize(188_416)).toBe("184 KB");
    expect(fileSize(2_621_440)).toBe("2,5 MB");
    expect(splitLines(" Go \n\n SQL\n")).toEqual(["Go", "SQL"]);
    expect(tooLong("a".repeat(2_000))).toBe(false);
    expect(tooLong("a".repeat(2_001))).toBe(true);
    expect(tooLong(null)).toBe(false);
  });
});

describe("résumé onboarding machine", () => {
  it("reads a file, reviews and creates the résumé", async () => {
    const { actor, reads, creates, created } = start();

    actor.send({ type: "start" });
    expect(actor.getSnapshot().value).toBe("choose");

    actor.send({ type: "select", file });
    actor.send({ type: "continue" });
    expect(actor.getSnapshot().matches({ reading: "loading" })).toBe(true);

    await waitFor(actor, (snapshot) => snapshot.matches({ reading: "read" }));
    expect(reads).toEqual([file]);

    actor.send({ type: "continue" });
    actor.send({ type: "open", section: "skills" });
    expect(actor.getSnapshot().context.section).toBe("skills");

    actor.send({ type: "close" });
    expect(actor.getSnapshot().context.section).toBeNull();

    const edited = { ...filled, skills: [{ id: "k3", name: "Rust" }] };

    actor.send({ type: "open", section: "skills" });
    actor.send({ type: "save", draft: edited });
    expect(actor.getSnapshot().context).toMatchObject({ draft: edited, section: null });

    actor.send({ type: "back" });
    expect(actor.getSnapshot().matches({ reading: "read" })).toBe(true);
    actor.send({ type: "continue" });

    actor.send({ type: "create" });
    await waitFor(actor, (snapshot) => snapshot.status === "done");
    expect(creates).toEqual([{ draft: edited, file }]);
    expect(created).toEqual([true]);
  });

  it("goes back and swaps the file", async () => {
    const { actor, reads } = start();

    actor.send({ type: "start" });
    actor.send({ type: "back" });
    expect(actor.getSnapshot().value).toBe("intro");

    actor.send({ type: "start" });
    actor.send({ type: "select", file });
    actor.send({ type: "continue" });
    await waitFor(actor, (snapshot) => snapshot.matches({ reading: "read" }));

    actor.send({ type: "back" });
    expect(actor.getSnapshot().value).toBe("choose");
    expect(isEmptyDraft(actor.getSnapshot().context.draft)).toBe(true);

    const other = new File(["%PDF"], "outro.pdf");

    actor.send({ type: "select", file: other });
    actor.send({ type: "continue" });
    await waitFor(actor, (snapshot) => snapshot.matches({ reading: "read" }));
    expect(reads).toEqual([file, other]);
  });

  it("creates from scratch without a file and refuses an empty résumé", async () => {
    const { actor, reads, creates, created } = start();

    actor.send({ type: "start" });
    actor.send({ type: "choose", method: "scratch" });
    actor.send({ type: "continue" });
    expect(actor.getSnapshot().value).toBe("review");
    expect(reads).toEqual([]);

    actor.send({ type: "create" });
    expect(actor.getSnapshot().context.error).toBe(
      "Preencha o título ou uma experiência para criar o currículo.",
    );

    actor.send({ type: "save", draft: filled });
    actor.send({ type: "back" });
    expect(actor.getSnapshot().value).toBe("choose");
    expect(isEmptyDraft(actor.getSnapshot().context.draft)).toBe(true);

    actor.send({ type: "continue" });
    actor.send({ type: "save", draft: { ...emptyDraft(), headline: { id: "h", text: "Dev" } } });
    actor.send({ type: "create" });
    await waitFor(actor, (snapshot) => snapshot.status === "done");
    expect(creates).toEqual([
      { draft: expect.objectContaining({ headline: { id: "h", text: "Dev" } }), file: null },
    ]);
  });

  it("asks for a file when none was chosen", async () => {
    const { actor, reads } = start();

    actor.send({ type: "start" });
    actor.send({ type: "choose", method: "file" });
    actor.send({ type: "continue" });
    await waitFor(actor, (snapshot) => snapshot.matches({ reading: "failed" }));
    expect(actor.getSnapshot().context.error).toBe("Escolha um arquivo.");
    expect(reads).toEqual([]);
  });

  it("shows failures to read and to create", async () => {
    const { actor } = start({
      read: async () => {
        throw new Error("Arquivo não é um currículo.");
      },
    });

    actor.send({ type: "start" });
    actor.send({ type: "select", file });
    actor.send({ type: "continue" });
    await waitFor(actor, (snapshot) => snapshot.matches({ reading: "failed" }));
    expect(actor.getSnapshot().context.error).toBe("Arquivo não é um currículo.");

    actor.send({ type: "back" });
    expect(actor.getSnapshot().context.error).toBe("");

    const silent = start({
      read: () => Promise.reject(new Error("")),
      create: () => Promise.reject("down"),
    });

    silent.actor.send({ type: "start" });
    silent.actor.send({ type: "select", file });
    silent.actor.send({ type: "continue" });
    await waitFor(silent.actor, (snapshot) => snapshot.matches({ reading: "failed" }));
    expect(silent.actor.getSnapshot().context.error).toBe("Não foi possível ler o currículo.");

    const creating = start({ create: () => Promise.reject(new Error("Limite diário.")) });

    creating.actor.send({ type: "start" });
    creating.actor.send({ type: "select", file });
    creating.actor.send({ type: "continue" });
    await waitFor(creating.actor, (snapshot) => snapshot.matches({ reading: "read" }));
    creating.actor.send({ type: "continue" });
    creating.actor.send({ type: "create" });
    await waitFor(creating.actor, (snapshot) => snapshot.context.error !== "");
    expect(creating.actor.getSnapshot()).toMatchObject({
      value: "review",
      context: { error: "Limite diário." },
    });

    const fallback = start({ create: () => Promise.reject("down") });

    fallback.actor.send({ type: "start" });
    fallback.actor.send({ type: "choose", method: "scratch" });
    fallback.actor.send({ type: "continue" });
    fallback.actor.send({ type: "save", draft: filled });
    fallback.actor.send({ type: "create" });
    await waitFor(fallback.actor, (snapshot) => snapshot.context.error !== "");
    expect(fallback.actor.getSnapshot().context.error).toBe("Não foi possível criar o currículo.");
  });
});
