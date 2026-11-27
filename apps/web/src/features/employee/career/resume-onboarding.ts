import { assign, fromPromise, setup } from "xstate";
import type { CareerResume } from "@/entities/career";

export type ResumeDraft = CareerResume["content"];

export type Experience = ResumeDraft["experiences"][number];

export type Education = ResumeDraft["education"][number];

export type SectionId =
  | "summary"
  | "experiences"
  | "education"
  | "skills"
  | "languages"
  | "contact";

export type Method = "file" | "scratch";

export const maxResumeBytes = 5_242_880;

export const textLimit = 2_000;

export const listLimit = 50;

export const bulletLimit = 20;

const newId = () => crypto.randomUUID();

export function emptyDraft() {
  const draft: ResumeDraft = {
    headline: { id: newId(), text: "" },
    summary: { id: newId(), text: "" },
    experiences: [],
    education: [],
    skills: [],
    languages: [],
    contact: { email: null, phone: null, city: null, links: [] },
  };

  return draft;
}

export function emptyExperience() {
  const experience: Experience = {
    id: newId(),
    company: "",
    role: "",
    start: "",
    end: null,
    bullets: [],
  };

  return experience;
}

export function emptyEducation() {
  const education: Education = { id: newId(), institution: "", degree: "", start: null, end: null };

  return education;
}

const blank = (value: string | null) => !value?.trim();

export function experienceProblem(experience: Experience) {
  if (blank(experience.role)) return "Falta o cargo.";

  if (blank(experience.company)) return "Falta a empresa.";

  if (blank(experience.start)) return "Falta a data de início.";

  return undefined;
}

export function educationProblem(education: Education) {
  if (blank(education.institution)) return "Falta a instituição.";

  if (blank(education.degree)) return "Falta o curso.";

  return undefined;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const list = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });

function lowerAfterFirst(names: string[]) {
  return names.map((name, index) => (index === 0 ? name : name.toLowerCase()));
}

function lineCount(text: string) {
  return text.split(/\n+/).filter((line) => line.trim()).length;
}

function contactDetail(contact: ResumeDraft["contact"]) {
  const present = [
    contact.email ? "E-mail" : null,
    contact.phone ? "telefone" : null,
    contact.city ? "cidade" : null,
    contact.links.some((link) => /linkedin\.com/i.test(link)) ? "LinkedIn" : null,
    contact.links.some((link) => !/linkedin\.com/i.test(link)) ? "links" : null,
  ].filter((item) => item !== null);

  if (present.length === 0) return "Nada encontrado";

  const [first, ...rest] = present;

  return list.format([first.charAt(0).toUpperCase() + first.slice(1), ...rest]);
}

export function sectionSummaries(draft: ResumeDraft) {
  const summaryLines = lineCount(draft.summary.text);

  const sections: { id: SectionId; title: string; detail: string; toCheck: number }[] = [
    {
      id: "summary",
      title: "Resumo profissional",
      detail: summaryLines ? plural(summaryLines, "linha", "linhas") : "Vazio",
      toCheck: blank(draft.headline.text) && draft.experiences.length === 0 ? 1 : 0,
    },
    {
      id: "experiences",
      title: "Experiências",
      detail: draft.experiences.length
        ? plural(draft.experiences.length, "cargo", "cargos")
        : "Nenhuma",
      toCheck: draft.experiences.filter((item) => experienceProblem(item)).length,
    },
    {
      id: "education",
      title: "Formação",
      detail: draft.education.length
        ? plural(draft.education.length, "curso", "cursos")
        : "Nenhuma",
      toCheck: draft.education.filter((item) => educationProblem(item)).length,
    },
    {
      id: "skills",
      title: "Competências",
      detail: draft.skills.length ? plural(draft.skills.length, "item", "itens") : "Nenhuma",
      toCheck: 0,
    },
    {
      id: "languages",
      title: "Idiomas",
      detail: draft.languages.length
        ? list.format(lowerAfterFirst(draft.languages.map((language) => language.name)))
        : "Nenhum",
      toCheck: 0,
    },
    {
      id: "contact",
      title: "Contato e links",
      detail: contactDetail(draft.contact),
      toCheck: 0,
    },
  ];

  return sections;
}

export function readingChecks(draft: ResumeDraft | null) {
  const counted = (label: string, items: unknown[]) => ({
    label: draft ? `${label} · ${items.length}` : label,
    found: draft ? items.length > 0 : null,
  });

  const contact = draft?.contact;

  return [
    {
      label: "Contato",
      found: contact
        ? Boolean(contact.email || contact.phone || contact.city || contact.links.length)
        : null,
    },
    counted("Experiências", draft?.experiences ?? []),
    counted("Formação", draft?.education ?? []),
    counted("Competências", draft?.skills ?? []),
  ];
}

export function isEmptyDraft(draft: ResumeDraft) {
  return blank(draft.headline.text) && draft.experiences.length === 0;
}

export function tooLong(value: string | null) {
  return (value?.length ?? 0) > textLimit;
}

export function overLimit(value: string, perLine = false) {
  return perLine ? value.split("\n").some(tooLong) : tooLong(value);
}

export function splitLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export type OnboardingDeps = {
  read: (file: File) => Promise<ResumeDraft>;
  create: (input: {
    draft: ResumeDraft;
    file: File | null;
    searchable: boolean | null;
  }) => Promise<void>;
  onCreated: () => void;
};

type Context = {
  method: Method;
  file: File | null;
  draft: ResumeDraft;
  section: SectionId | null;
  searchable: boolean | null;
  error: string;
};

type Event =
  | { type: "start" }
  | { type: "choose"; method: Method }
  | { type: "continue" }
  | { type: "select"; file: File }
  | { type: "back" }
  | { type: "open"; section: SectionId }
  | { type: "close" }
  | { type: "save"; draft: ResumeDraft }
  | { type: "searchable"; value: boolean }
  | { type: "create" };

export function onboardingMachine(deps: OnboardingDeps) {
  const read = fromPromise<ResumeDraft, File | null>(({ input }) =>
    input ? deps.read(input) : Promise.reject(new Error("Escolha um arquivo.")),
  );

  const create = fromPromise<
    void,
    { draft: ResumeDraft; file: File | null; searchable: boolean | null }
  >(({ input }) => deps.create(input));

  return setup<Context, Event, { read: typeof read; create: typeof create }>({
    actors: { read, create },
  }).createMachine({
    id: "resume-onboarding",
    context: () => ({
      method: "file",
      file: null,
      draft: emptyDraft(),
      section: null,
      searchable: null,
      error: "",
    }),
    initial: "intro",
    states: {
      intro: { on: { start: "choose" } },
      choose: {
        on: {
          back: "intro",
          choose: { actions: assign({ method: ({ event }) => event.method, error: "" }) },
          select: {
            actions: assign({ file: ({ event }) => event.file, method: "file", error: "" }),
          },
          continue: [
            {
              guard: ({ context }) => context.method === "scratch",
              target: "review",
              actions: assign({ draft: () => emptyDraft(), file: null }),
            },
            { target: "reading" },
          ],
        },
      },
      reading: {
        initial: "loading",
        on: {
          back: { target: "choose", actions: assign({ draft: () => emptyDraft(), error: "" }) },
        },
        states: {
          loading: {
            invoke: {
              src: "read",
              input: ({ context }) => context.file,
              onDone: { target: "read", actions: assign({ draft: ({ event }) => event.output }) },
              onError: {
                target: "failed",
                actions: assign({
                  error: ({ event }) =>
                    event.error instanceof Error && event.error.message
                      ? event.error.message
                      : "Não foi possível ler o currículo.",
                }),
              },
            },
          },
          read: { on: { continue: "#resume-onboarding.review" } },
          failed: {},
        },
      },
      review: {
        on: {
          back: [
            {
              guard: ({ context }) => context.method === "scratch",
              target: "choose",
              actions: assign({ draft: () => emptyDraft(), section: null, error: "" }),
            },
            { target: "reading.read", actions: assign({ section: null, error: "" }) },
          ],
          open: { actions: assign({ section: ({ event }) => event.section }) },
          close: { actions: assign({ section: null }) },
          save: { actions: assign({ draft: ({ event }) => event.draft, section: null }) },
          searchable: { actions: assign({ searchable: ({ event }) => event.value }) },
          create: [
            {
              guard: ({ context }) => !isEmptyDraft(context.draft),
              target: "creating",
              actions: assign({ error: "" }),
            },
            {
              actions: assign({
                error: "Preencha o título ou uma experiência para criar o currículo.",
              }),
            },
          ],
        },
      },
      creating: {
        invoke: {
          src: "create",
          input: ({ context }) => ({
            draft: context.draft,
            file: context.file,
            searchable: context.searchable,
          }),
          onDone: { target: "created", actions: () => deps.onCreated() },
          onError: {
            target: "review",
            actions: assign({
              error: ({ event }) =>
                event.error instanceof Error && event.error.message
                  ? event.error.message
                  : "Não foi possível criar o currículo.",
            }),
          },
        },
      },
      created: { type: "final" },
    },
  });
}
