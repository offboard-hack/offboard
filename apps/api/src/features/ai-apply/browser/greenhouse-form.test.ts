import { readFileSync } from "node:fs";
import type { ConfirmedAnswer, FormQuestion } from "@offboard/db/schema";
import { describe, expect, it } from "vitest";
import { readGreenhouseForm } from "../greenhouse.js";
import type { Page } from "./cdp.js";
import {
  awaitOutcome,
  challengeVisible,
  checkForm,
  classifyOutcome,
  fillGreenhouse,
  liveFormFrom,
  locationMatches,
  readLiveForm,
  submitGreenhouse,
  type FormPage,
  type LiveForm,
  type OutcomePage,
} from "./greenhouse-form.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

const stoneApi = fixture("greenhouse-stone.json");
const stoneLive = JSON.parse(fixture("greenhouse-stone-live.json")).questions;

const control = (id: string, name = "", labelledBy = "") => ({ id, name, labelledBy });

const stoneRequired = [
  control("first_name"),
  control("last_name"),
  control("email"),
  control("country"),
  control(""),
  control("phone"),
  control("candidate-location"),
  control("", "", "upload-label-resume"),
  control("question_35399730003"),
  control("question_35399731003"),
  control("question_35399732003"),
  control("question_35399734003"),
  control("question_35399735003"),
  control("question_35399737003"),
  control("question_35399738003[]"),
  control("question_35399738003[]_173418903003", "question_35399738003[]"),
  control("question_35399739003[]"),
  control("question_35399740003"),
  control("question_35399743003"),
  control("question_35399747003"),
];

const stonePage: FormPage = {
  href: "https://job-boards.greenhouse.io/stone/jobs/8201530003",
  form: true,
  password: false,
  title: "Job Application for Account Executive at Stone",
  notices: [],
  questions: stoneLive,
  required: stoneRequired,
};

const quiet: OutcomePage = {
  path: "/stone/jobs/8201530003",
  form: true,
  frames: [
    { src: "https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1&k=x", visible: true },
  ],
  errors: [],
  confirmations: [],
};

const bframe = { src: "https://www.recaptcha.net/recaptcha/enterprise/bframe?k=x", visible: true };

const challenged: OutcomePage = { ...quiet, frames: [...quiet.frames, bframe] };

const errored: OutcomePage = {
  ...quiet,
  errors: [{ text: "Este campo é obrigatório.", visible: true }],
};

const confirmedPage: OutcomePage = {
  path: "/stone/jobs/8201530003/confirmation",
  form: false,
  frames: [],
  errors: [],
  confirmations: [{ text: "Recebemos sua inscrição.", visible: true }],
};

type Setup = {
  missing?: string[];
  menus?: Record<string, string[]>;
  suggestions?: string[];
  coordinates?: boolean;
  stateLocation?: string;
  rejectUpload?: boolean;
  readBack?: (id: string, typed: string) => string;
  shownAs?: Record<string, string>;
  checked?: string[];
  stuck?: string[];
  prefilled?: Record<string, string>;
  hiddenLetter?: boolean;
  menuDelay?: boolean;
  unready?: boolean;
  form?: Partial<FormPage>;
  pages?: OutcomePage[];
  unguarded?: boolean;
};

const countries = ["Brasil +55", "Gibraltar +350", "Portugal +351"];

const signals = (page: OutcomePage) =>
  page.path.includes("/confirmation") || page.confirmations.length > 0;

const fakePage = (setup: Setup = {}) => {
  const actions: string[] = [];
  const waits: string[] = [];
  const values = new Map(Object.entries(setup.prefilled ?? {}));
  const shown = new Map<string, string>();
  const checked = new Set(setup.checked ?? []);
  const attached = new Map<string, string>();
  const menus = new Map(Object.entries({ country: countries, ...setup.menus }));
  const pages = setup.pages ?? [quiet];
  let revealed = !setup.hiddenLetter;
  let focused = "";
  let search = "";
  let located = false;
  let at = 0;
  let cursor = 0;

  const idOf = (selector: string) =>
    selector.startsWith("[id=") ? JSON.parse(selector.slice(4, -1)) : selector;

  const present = (id: string) =>
    !(setup.missing ?? []).includes(id) && (id !== "cover_letter_text" || revealed);

  const literal = (expression: string) => {
    const match = /querySelector(?:All)?\(("(?:[^"\\]|\\.)*")\)/.exec(expression);

    return match?.[1] === undefined ? "" : JSON.parse(match[1]);
  };

  const labelsOf = (id: string) =>
    id === "candidate-location" ? (setup.suggestions ?? []) : (menus.get(id) ?? []);

  const filtered = (id: string) =>
    labelsOf(id).flatMap((text, index) =>
      text.toLowerCase().includes(search.toLowerCase()) ? [{ text, index }] : [],
    );

  const states = () => {
    if (!located) return [];

    const filled = setup.coordinates !== false;

    return [
      {
        location: setup.stateLocation ?? shown.get("candidate-location") ?? "",
        latitude: filled ? "-23.570533" : "",
        longitude: filled ? "-46.663713" : "",
      },
    ];
  };

  const reply = (expression: string) => {
    if (expression.includes("loaderData")) return { ...stonePage, ...setup.form };

    if (expression.includes("armed = true")) {
      actions.push("guard");

      return true;
    }

    if (expression.includes("armed = false")) {
      actions.push("lift");

      return !setup.unguarded;
    }

    if (expression.includes('querySelectorAll("iframe")')) return pages[at] ?? quiet;

    if (expression.includes("memoizedState")) return states();

    if (expression.includes('[role=\\"option\\"]')) {
      const id = literal(expression)
        .split('"')[1]
        .replace(/^react-select-|-listbox$/g, "");

      return filtered(id).map(({ text, index }) => ({
        id: `react-select-${id}-option-${index}`,
        text,
      }));
    }

    if (expression.includes('type=\\"checkbox\\"')) {
      const name = /name="(.*)"\]$/.exec(literal(expression))?.[1] ?? "";

      return [...checked].flatMap((id) =>
        id.startsWith(`${name}_`) ? [id.slice(name.length + 1)] : [],
      );
    }

    const id = idOf(literal(expression));

    if (expression.endsWith(" !== null")) return present(id);

    if (expression.includes(".select__single-value")) {
      return setup.shownAs?.[id] ?? shown.get(id) ?? null;
    }

    if (expression.endsWith("?.tagName ?? null")) {
      if (!present(id)) return null;

      return id === "cover_letter_text" ? "TEXTAREA" : "INPUT";
    }

    if (expression.endsWith("?.checked ?? null")) return present(id) ? checked.has(id) : null;

    if (expression.endsWith("?.value ?? null")) return present(id) ? (values.get(id) ?? "") : null;

    throw new Error(`unexpected expression ${expression}`);
  };

  const ready = (expression: string) => {
    if (expression.includes("readyState")) return !setup.unready;

    if (expression.includes('location.pathname.includes("/confirmation")')) {
      const next = pages.findIndex((item, index) => index >= cursor && signals(item));

      if (next === -1) {
        at = pages.length - 1;

        return false;
      }

      at = next;
      cursor = next + 1;

      return true;
    }

    if (expression.includes("memoizedState")) return states().some((state) => state.latitude);

    if (expression.includes("file-upload__filename")) {
      const name = /upload-label-(.*?)\\"/.exec(expression)?.[1] ?? "";
      const file = /includes\((".*")\)\)$/.exec(expression)?.[1] ?? '""';

      return attached.get(name) === JSON.parse(file);
    }

    if (expression.includes("-listbox")) return !setup.menuDelay;

    if (expression.includes("-option-0")) return filtered("candidate-location").length > 0;

    return present(idOf(literal(expression)));
  };

  const page: Page = {
    async navigate() {},
    async evaluate(expression, schema) {
      return schema.parse(reply(expression));
    },
    async waitFor(expression) {
      waits.push(expression);

      return ready(expression);
    },
    async click(selector) {
      actions.push(`click ${selector}`);

      if (selector === '[data-testid="cover_letter-text"]') {
        revealed = true;

        return;
      }

      const id = idOf(selector);
      const option = /^react-select-(.+)-option-(\d+)$/.exec(id);

      if (option?.[1] !== undefined && option[2] !== undefined) {
        const owner = option[1];

        shown.set(owner, labelsOf(owner)[Number(option[2])] ?? "");
        located = owner === "candidate-location";

        return;
      }

      focused = id;
      search = "";

      if (id.includes("[]_") && !(setup.stuck ?? []).includes(id)) {
        if (checked.has(id)) checked.delete(id);
        else checked.add(id);
      }
    },
    async type(text) {
      actions.push(`type ${text}`);

      if (menus.has(focused) || focused === "candidate-location") {
        search += text;

        return;
      }

      values.set(focused, setup.readBack?.(focused, text) ?? text);
    },
    async press(key) {
      actions.push(`press ${key}`);
    },
    async setFiles(selector, paths) {
      actions.push(`setFiles ${selector} ${paths.join(",")}`);

      const file = paths[0]?.split("/").at(-1) ?? "";

      if (!setup.rejectUpload) attached.set(idOf(selector), file);
    },
    async screenshot() {
      return new Uint8Array();
    },
    async url() {
      return stonePage.href;
    },
    close() {},
  };

  return { page, actions, waits };
};

const stoneQuestions = async () => {
  const fetchImpl = async () =>
    new Response(stoneApi, { headers: { "content-type": "application/json" } });

  const result = await readGreenhouseForm(fetchImpl, "stone", "8201530003");

  if ("error" in result) throw new Error(result.error);

  return result.questions;
};

const question = (
  id: string,
  type: FormQuestion["fields"][number]["type"],
  options: string[] = [],
  required = true,
) =>
  ({
    id,
    label: id,
    required,
    section: "questions",
    fields: [
      {
        name: id,
        type,
        options: options.map((label, index) => ({ label, value: String(index + 1) })),
      },
    ],
    kind: "custom",
    sensitive: false,
  }) satisfies FormQuestion;

type Files = { resume: string; coverLetter: string | null; coverLetterText: string | null };

const files: Files = {
  resume: "/tmp/.uploads/curriculo.pdf",
  coverLetter: null,
  coverLetterText: null,
};

const account = { firstName: "Ana", lastName: "Souza", email: "ana@example.com" };

const fill = (
  page: Page,
  questions: FormQuestion[],
  confirmed: ConfirmedAnswer[],
  overrides: { files?: Files; attach?: boolean } = {},
) =>
  fillGreenhouse(page, {
    questions,
    confirmed,
    account,
    files: overrides.files ?? files,
    phoneCountry: "BR",
    attach: overrides.attach ?? true,
  });

const answers = (entries: Record<string, string | string[] | null>) =>
  Object.entries(entries).map(([questionId, value]) => ({ questionId, value }));

const live = (fields: LiveForm["fields"]) =>
  ({
    fields,
    ready: true,
    closed: false,
    loginRequired: false,
    blocked: false,
  }) satisfies LiveForm;

const steps = (actions: string[]) => actions.filter((action) => action !== "guard");

const changed = (field: string) => ({ failed: "form_changed", field });

describe("reads the live form", () => {
  it("reads the Stone form as it renders", async () => {
    const { page, waits } = fakePage();

    const form = await readLiveForm(page);

    expect(waits).toHaveLength(1);
    expect(form).toMatchObject({
      ready: true,
      closed: false,
      loginRequired: false,
      blocked: false,
    });
    expect(form.fields.map((field) => field.name).slice(0, 7)).toEqual([
      "first_name",
      "last_name",
      "email",
      "phone",
      "location",
      "latitude",
      "longitude",
    ]);
    expect(form.fields.find((field) => field.name === "question_35399734003")).toEqual({
      name: "question_35399734003",
      required: true,
      options: ["1", "0"],
    });
  });

  it("matches the confirmed Stone questions", async () => {
    const { page } = fakePage();
    const questions = await stoneQuestions();

    const confirmed = answers({
      question_35399732003: "173418878003",
      "question_35399738003[]": ["173418910003"],
    });

    expect(checkForm(await readLiveForm(page), questions, confirmed)).toBe("ok");
  });

  it("fails closed when the page never gets ready", async () => {
    const { page } = fakePage({ unready: true });

    const form = await readLiveForm(page);

    expect(form).toEqual({
      fields: [],
      ready: false,
      closed: false,
      loginRequired: false,
      blocked: false,
    });
    expect(checkForm(form, [], [])).toBe("form_changed");
  });

  it("detects a closed job from the redirect, the notice or a 404", () => {
    const gone = { ...stonePage, form: false, questions: null, required: [] };

    expect(
      liveFormFrom({ ...gone, href: "https://job-boards.greenhouse.io/stone?error=true" }),
    ).toMatchObject({ closed: true, blocked: false, loginRequired: false });
    expect(
      liveFormFrom({ ...gone, notices: ["A vaga que você está procurando não está mais aberta."] }),
    ).toMatchObject({ closed: true, blocked: false });
    expect(
      liveFormFrom({ ...gone, notices: ["The job you are looking for is no longer open."] }),
    ).toMatchObject({ closed: true });
    expect(liveFormFrom({ ...gone, title: "404 - Page not found" })).toMatchObject({
      closed: true,
    });
  });

  it("detects a sign-in wall", async () => {
    const password = fakePage({ form: { form: false, password: true, questions: null } });

    const signIn = liveFormFrom({
      ...stonePage,
      href: "https://my.greenhouse.io/users/sign_in",
      form: false,
    });

    expect(await readLiveForm(password.page)).toEqual({
      fields: [],
      ready: true,
      closed: false,
      loginRequired: true,
      blocked: false,
    });
    expect(signIn).toMatchObject({ closed: false, loginRequired: true, blocked: false });
  });

  it("treats any other page without a form as blocked", () => {
    const denied = liveFormFrom({ ...stonePage, form: false, title: "Access denied", notices: [] });

    expect(denied).toMatchObject({ closed: false, loginRequired: false, blocked: true });
  });

  it("reads only the rendered controls when the form data is missing or unreadable", async () => {
    const missing = fakePage({ form: { questions: null } });
    const unreadable = liveFormFrom(formPageWith({ questions: null }));

    const form = await readLiveForm(missing.page);

    expect(form.fields.every((field) => field.required && field.options.length === 0)).toBe(true);
    expect(form.fields.map((field) => field.name)).toContain("location");
    expect(unreadable.fields).toEqual(form.fields);
    expect(checkForm(form, await stoneQuestions(), [])).toBe("form_changed");
  });

  it("names rendered required controls after the API fields", () => {
    const form = liveFormFrom({
      ...stonePage,
      questions: [],
      required: [
        control("candidate-location"),
        control("country"),
        control("question_1[]_9", "question_1[]"),
        control("question_1[]"),
        control("", "question_2"),
        control("", "", "upload-label-resume"),
        control("", "", "other-label"),
        control(""),
      ],
    });

    expect(form.fields.map((field) => field.name)).toEqual([
      "location",
      "phone",
      "question_1[]",
      "question_2",
      "resume",
    ]);
  });

  it("reports a required control rendered outside the form data", async () => {
    const { page } = fakePage({
      form: { required: [...stoneRequired, control("question_99999999")] },
    });

    expect(checkForm(await readLiveForm(page), await stoneQuestions(), [])).toBe("form_changed");
  });
});

const formPageWith = (overrides: Partial<FormPage>) => ({ ...stonePage, ...overrides });

describe("reports a changed form", () => {
  const choice = question("question_1", "single_select", ["Sim", "Não"]);
  const optional = question("question_2", "text", [], false);
  const choiceField = { name: "question_1", required: true, options: ["1", "2"] };
  const optionalField = { name: "question_2", required: false, options: [] };
  const base = [choiceField, optionalField];

  it("accepts an unchanged form", () => {
    expect(
      checkForm(live(base), [choice, optional], answers({ question_1: "2", question_2: "x" })),
    ).toBe("ok");
  });

  it("reports a new required field", () => {
    const fields = [...base, { name: "question_3", required: true, options: [] }];

    expect(checkForm(live(fields), [choice, optional], answers({ question_1: "1" }))).toBe(
      "form_changed",
    );
  });

  it("reports a removed option", () => {
    const fields = [{ ...choiceField, options: ["1"] }, optionalField];

    expect(checkForm(live(fields), [choice], answers({ question_1: "2" }))).toBe("form_changed");
  });

  it("reports a removed option in a checkbox group", () => {
    const group = question("question_4[]", "multi_select", ["a", "b"]);
    const fields = [{ name: "question_4[]", required: true, options: ["1"] }];

    expect(checkForm(live(fields), [group], answers({ "question_4[]": ["1", "2"] }))).toBe(
      "form_changed",
    );
  });

  it("reports a removed required question", () => {
    expect(checkForm(live([optionalField]), [choice], answers({ question_1: "1" }))).toBe(
      "form_changed",
    );
  });

  it("reports a removed optional question that has an answer", () => {
    expect(
      checkForm(
        live([choiceField]),
        [choice, optional],
        answers({ question_1: "1", question_2: "x" }),
      ),
    ).toBe("form_changed");
    expect(
      checkForm(
        live([choiceField]),
        [choice, optional],
        answers({ question_1: "1", question_2: null }),
      ),
    ).toBe("ok");
  });

  it("reports an optional question that became required", () => {
    const fields = [choiceField, { ...optionalField, required: true }];

    expect(
      checkForm(live(fields), [choice, optional], answers({ question_1: "1", question_2: "x" })),
    ).toBe("form_changed");
  });

  it("reports a required question without fields or without a live counterpart", () => {
    const document = { ...question("document:1", "file"), fields: [] };

    const demographic = {
      ...question("demographic:7", "single_select", ["a"]),
      section: "demographic" as const,
    };

    expect(checkForm(live([]), [document], [])).toBe("form_changed");
    expect(checkForm(live([]), [{ ...document, required: false }], [])).toBe("ok");
    expect(checkForm(live(base), [choice, optional, demographic], [])).toBe("form_changed");
  });
});

describe("guards the form while filling", () => {
  it("installs the submit guard before the first fill action", async () => {
    const { page, actions } = fakePage();
    const text = question("question_1", "text");

    await fill(page, [text], answers({ question_1: "x" }));

    expect(actions[0]).toBe("guard");
    expect(actions).toEqual(["guard", 'click [id="question_1"]', "type x"]);
  });

  it("refuses a line break for a single-line input", async () => {
    const { page, actions } = fakePage();
    const text = question("question_1", "text");

    expect(await fill(page, [text], answers({ question_1: "a\nb" }))).toEqual(
      changed("question_1"),
    );
    expect(steps(actions)).toEqual([]);
  });
});

describe("fills each field kind", () => {
  it("types text after clicking the field", async () => {
    const { page, actions } = fakePage();
    const text = question("question_35399730003", "text");

    expect(
      await fill(page, [text], answers({ question_35399730003: "123.456.789-00" })),
    ).toBeUndefined();
    expect(steps(actions)).toEqual(['click [id="question_35399730003"]', "type 123.456.789-00"]);
  });

  it("fills name and email from the account", async () => {
    const { page, actions } = fakePage();
    const questions = (await stoneQuestions()).slice(0, 3);

    expect(
      await fill(page, questions, answers({ first_name: "Outra", last_name: "P", email: "x@y.z" })),
    ).toBeUndefined();
    expect(steps(actions)).toEqual([
      'click [id="first_name"]',
      "type Ana",
      'click [id="last_name"]',
      "type Souza",
      'click [id="email"]',
      "type ana@example.com",
    ]);
  });

  it("skips hidden fields, empty answers and unrequested files", async () => {
    const { page, actions } = fakePage();
    const hidden = { ...question("latitude", "hidden"), section: "location" as const };
    const empty = question("question_2", "text", [], false);
    const document = { ...question("question_9", "file"), kind: "document" as const };
    const bare = { ...question("document:1", "file"), fields: [] };

    expect(
      await fill(page, [hidden, empty, document, bare], answers({ question_2: null })),
    ).toBeUndefined();
    expect(steps(actions)).toEqual([]);
  });

  it("types the confirmed option's label and clicks the exact option", async () => {
    const { page, actions } = fakePage({
      menus: { question_1: ["Ensino médio incompleto", "Ensino médio completo"] },
    });

    const choice = question("question_1", "single_select", [
      "Ensino médio incompleto",
      "Ensino médio completo",
    ]);

    expect(await fill(page, [choice], answers({ question_1: "2" }))).toBeUndefined();
    expect(steps(actions)).toEqual([
      'click [id="question_1"]',
      "type Ensino médio completo",
      'click [id="react-select-question_1-option-1"]',
    ]);
  });

  it("clicks the exact option when a longer option is listed first", async () => {
    const { page, actions } = fakePage({ menus: { question_1: ["Sim, com certeza", "Sim"] } });
    const choice = question("question_1", "single_select", ["Sim, com certeza", "Sim"]);

    expect(await fill(page, [choice], answers({ question_1: "2" }))).toBeUndefined();
    expect(steps(actions)).toEqual([
      'click [id="question_1"]',
      "type Sim",
      'click [id="react-select-question_1-option-1"]',
    ]);
  });

  it("closes the menu when no option matches the label", async () => {
    const { page, actions } = fakePage({ menus: { question_1: ["Yes", "No"] } });
    const choice = question("question_1", "single_select", ["Sim", "Não"]);

    expect(await fill(page, [choice], answers({ question_1: "1" }))).toEqual(changed("question_1"));
    expect(steps(actions)).toEqual(['click [id="question_1"]', "type Sim", "press Escape"]);
  });

  it("reports a combobox that shows another value", async () => {
    const { page } = fakePage({ menus: { question_1: ["Sim"] }, shownAs: { question_1: "Não" } });
    const choice = question("question_1", "single_select", ["Sim"]);

    expect(await fill(page, [choice], answers({ question_1: "1" }))).toEqual(changed("question_1"));
  });

  it("reports a combobox whose menu shows no options or never opens", async () => {
    const choice = question("question_1", "single_select", ["Sim"]);
    const empty = fakePage({ menus: { question_1: [] } });
    const closed = fakePage({ menus: { question_1: ["Sim"] }, menuDelay: true });

    expect(await fill(empty.page, [choice], answers({ question_1: "1" }))).toEqual(
      changed("question_1"),
    );
    expect(await fill(closed.page, [choice], answers({ question_1: "1" }))).toEqual(
      changed("question_1"),
    );
    expect(steps(closed.actions)).toEqual(['click [id="question_1"]', "type Sim", "press Escape"]);
  });

  it("reports a missing combobox without touching the page", async () => {
    const { page, actions } = fakePage({ missing: ["question_1"] });
    const choice = question("question_1", "single_select", ["Sim"]);

    expect(await fill(page, [choice], answers({ question_1: "1" }))).toEqual(changed("question_1"));
    expect(steps(actions)).toEqual([]);
  });

  it("reports a confirmed value that is not an option", async () => {
    const { page, actions } = fakePage({ menus: { question_1: ["Sim"] } });
    const choice = question("question_1", "single_select", ["Sim"]);

    expect(await fill(page, [choice], answers({ question_1: "9" }))).toEqual(changed("question_1"));
    expect(steps(actions)).toEqual([]);
  });

  it("ticks each confirmed checkbox", async () => {
    const { page, actions } = fakePage();
    const group = question("question_4[]", "multi_select", ["a", "b", "c"]);

    expect(await fill(page, [group], answers({ "question_4[]": ["1", "3"] }))).toBeUndefined();
    expect(steps(actions)).toEqual(['click [id="question_4[]_1"]', 'click [id="question_4[]_3"]']);
  });

  it("leaves a checkbox that is already ticked", async () => {
    const { page, actions } = fakePage({ checked: ["question_4[]_1"] });
    const group = question("question_4[]", "multi_select", ["a", "b"]);

    expect(await fill(page, [group], answers({ "question_4[]": ["1"] }))).toBeUndefined();
    expect(steps(actions)).toEqual([]);
  });

  it("reports a checkbox that is missing, stuck, or an extra tick", async () => {
    const group = question("question_4[]", "multi_select", ["a", "b"]);
    const missing = fakePage({ missing: ["question_4[]_2"] });
    const stuck = fakePage({ stuck: ["question_4[]_1"] });
    const extra = fakePage({ checked: ["question_4[]_2"] });

    expect(await fill(missing.page, [group], answers({ "question_4[]": ["2"] }))).toEqual(
      changed("question_4[]"),
    );
    expect(await fill(stuck.page, [group], answers({ "question_4[]": ["1"] }))).toEqual(
      changed("question_4[]"),
    );
    expect(await fill(extra.page, [group], answers({ "question_4[]": ["1"] }))).toEqual(
      changed("question_4[]"),
    );
  });

  it("chooses Brazil for the phone and types the confirmed number", async () => {
    const { page, actions } = fakePage();
    const [phone] = (await stoneQuestions()).filter((item) => item.kind === "phone");

    if (phone === undefined) throw new Error("phone");

    expect(await fill(page, [phone], answers({ phone: "+55 11 91234-5678" }))).toBeUndefined();
    expect(steps(actions)).toEqual([
      'click [id="country"]',
      "type Bra",
      'click [id="react-select-country-option-0"]',
      'click [id="phone"]',
      "type +55 11 91234-5678",
    ]);
  });

  it("accepts a phone the form reformats and skips an empty phone", async () => {
    const { page, actions } = fakePage({ readBack: () => "(11) 91234-5678" });
    const phone = { ...question("phone", "text"), kind: "phone" as const };

    expect(await fill(page, [phone], answers({ phone: "11 91234 5678" }))).toBeUndefined();
    expect(await fill(fakePage().page, [phone], answers({ phone: null }))).toBeUndefined();
    expect(actions.filter((action) => action.startsWith("type"))).toEqual([
      "type Bra",
      "type 11 91234 5678",
    ]);
  });

  it("clicks Brazil after Gibraltar and types a phone without a country control", async () => {
    const listed = fakePage({ menus: { country: ["Gibraltar +350", "Brazil +55"] } });
    const plain = fakePage({ missing: ["country"] });
    const phone = { ...question("phone", "text"), kind: "phone" as const };

    expect(await fill(listed.page, [phone], answers({ phone: "11" }))).toBeUndefined();
    expect(listed.actions).toContain('click [id="react-select-country-option-1"]');
    expect(await fill(plain.page, [phone], answers({ phone: "11" }))).toBeUndefined();
    expect(steps(plain.actions)).toEqual(['click [id="phone"]', "type 11"]);
  });

  it("reports a phone country that is not offered or not shown", async () => {
    const phone = { ...question("phone", "text"), kind: "phone" as const };
    const absent = fakePage({ menus: { country: ["Gibraltar +350"] } });
    const other = fakePage({ shownAs: { country: "+350" } });

    expect(await fill(absent.page, [phone], answers({ phone: "11" }))).toEqual(changed("country"));
    expect(await fill(other.page, [phone], answers({ phone: "11" }))).toEqual(changed("country"));
  });

  it("reports text the form did not keep", async () => {
    const text = question("question_1", "text");
    const truncated = fakePage({ readBack: (_, typed) => typed.slice(0, 3) });
    const missing = fakePage({ missing: ["question_1"] });

    expect(await fill(truncated.page, [text], answers({ question_1: "abcdef" }))).toEqual(
      changed("question_1"),
    );
    expect(await fill(missing.page, [text], answers({ question_1: "abc" }))).toEqual(
      changed("question_1"),
    );
    expect(steps(missing.actions)).toEqual([]);
  });

  it("reports an answer whose shape does not fit the field", async () => {
    const { page } = fakePage();

    expect(
      await fill(page, [question("question_1", "text")], answers({ question_1: ["a"] })),
    ).toEqual(changed("question_1"));
    expect(
      await fill(
        page,
        [question("question_1", "single_select", ["a"])],
        answers({ question_1: ["1"] }),
      ),
    ).toEqual(changed("question_1"));
  });

  it("types the city, picks the first suggestion and checks it", async () => {
    const { page, actions } = fakePage({
      suggestions: ["São Paulo, Brazil", "Sao Bernardo do Campo, Sao Paulo, Brazil"],
    });

    const [location] = (await stoneQuestions()).filter((item) => item.id === "location");

    if (location === undefined) throw new Error("location");

    expect(await fill(page, [location], answers({ location: "Sao Paulo" }))).toBeUndefined();
    expect(steps(actions)).toEqual([
      'click [id="candidate-location"]',
      "type Sao Paulo",
      'click [id="react-select-candidate-location-option-0"]',
    ]);
  });

  it('types only the city of a "Cidade, UF" answer and accepts its suggestion', async () => {
    const { page, actions } = fakePage({ suggestions: ["São Paulo, Brazil"] });

    const [location] = (await stoneQuestions()).filter((item) => item.id === "location");

    if (location === undefined) throw new Error("location");

    expect(await fill(page, [location], answers({ location: "São Paulo, SP" }))).toBeUndefined();
    expect(steps(actions)).toEqual([
      'click [id="candidate-location"]',
      "type São Paulo",
      'click [id="react-select-candidate-location-option-0"]',
    ]);
  });

  it('types only the city of a "Cidade - UF" answer and checks the state of the suggestion', async () => {
    const [location] = (await stoneQuestions()).filter((item) => item.id === "location");

    if (location === undefined) throw new Error("location");

    const piaui = fakePage({ suggestions: ["Bom Jesus, Piauí, Brazil"] });
    const gaucho = fakePage({ suggestions: ["Bom Jesus, Rio Grande do Sul, Brazil"] });

    expect(
      await fill(piaui.page, [location], answers({ location: "Bom Jesus - PI" })),
    ).toBeUndefined();
    expect(steps(piaui.actions)).toContain("type Bom Jesus");
    expect(await fill(gaucho.page, [location], answers({ location: "Bom Jesus, PI" }))).toEqual(
      changed("location"),
    );
  });

  it("reports a first suggestion for another city", async () => {
    const location = {
      ...question("location", "text"),
      section: "location" as const,
      kind: "city" as const,
    };

    const { page } = fakePage({
      suggestions: ["Sao Bernardo do Campo, Sao Paulo, Brazil", "São Paulo, Brazil"],
    });

    expect(await fill(page, [location], answers({ location: "São Paulo" }))).toEqual(
      changed("location"),
    );
  });

  it("reports a city without suggestions, coordinates, matching state or a control", async () => {
    const location = {
      ...question("location", "text"),
      section: "location" as const,
      kind: "city" as const,
    };

    const none = fakePage({ suggestions: [] });
    const nowhere = fakePage({ suggestions: ["São Paulo, Brazil"], coordinates: false });
    const stale = fakePage({ suggestions: ["São Paulo, Brazil"], stateLocation: "Rio, Brazil" });
    const missing = fakePage({ missing: ["candidate-location"] });

    expect(await fill(none.page, [location], answers({ location: "Xyz" }))).toEqual(
      changed("location"),
    );
    expect(none.actions.at(-1)).toBe("press Escape");
    expect(await fill(nowhere.page, [location], answers({ location: "São Paulo" }))).toEqual(
      changed("location"),
    );
    expect(await fill(stale.page, [location], answers({ location: "São Paulo" }))).toEqual(
      changed("location"),
    );
    expect(await fill(missing.page, [location], answers({ location: "São Paulo" }))).toEqual(
      changed("location"),
    );
  });

  it("fills the whole Stone form with only the confirmed answers", async () => {
    const { page, actions } = fakePage({
      menus: {
        question_35399732003: ["Ensino médio completo", "Ensino superior completo"],
        question_35399734003: ["Yes", "No"],
      },
      suggestions: ["São Paulo, Brazil"],
    });

    const result = await fill(
      page,
      await stoneQuestions(),
      answers({
        phone: "11 91234-5678",
        location: "São Paulo",
        question_35399730003: "123.456.789-00",
        question_35399732003: "173418878003",
        question_35399734003: "1",
        "question_35399738003[]": ["173418910003"],
        question_35399736003: null,
      }),
    );

    expect(result).toBeUndefined();
    expect(actions.filter((action) => action.startsWith("type"))).toEqual([
      "type Ana",
      "type Souza",
      "type ana@example.com",
      "type Bra",
      "type 11 91234-5678",
      "type 123.456.789-00",
      "type Ensino médio completo",
      "type Yes",
      "type São Paulo",
    ]);
    expect(actions).toContain('setFiles [id="resume"] /tmp/.uploads/curriculo.pdf');
    expect(actions).toContain('click [id="question_35399738003[]_173418910003"]');
    expect(actions.some((action) => action.startsWith("press Enter"))).toBe(false);
  });
});

describe("leaves unanswered questions empty", () => {
  it("reports a field that holds a value nobody confirmed", async () => {
    const text = question("question_1", "text", [], false);
    const { page } = fakePage({ prefilled: { question_1: "autofill" } });

    expect(await fill(page, [text], answers({ question_1: null }))).toEqual(changed("question_1"));
  });

  it("reports an unanswered select, checkbox group or city that shows a value", async () => {
    const choice = question("question_1", "single_select", ["a"], false);
    const group = question("question_2[]", "multi_select", ["a"], false);

    const location = {
      ...question("location", "text", [], false),
      section: "location" as const,
    };

    const selected = fakePage({ shownAs: { question_1: "a" } });
    const ticked = fakePage({ checked: ["question_2[]_1"] });
    const located = fakePage({ shownAs: { "candidate-location": "São Paulo, Brazil" } });

    expect(await fill(selected.page, [choice], [])).toEqual(changed("question_1"));
    expect(await fill(ticked.page, [group], [])).toEqual(changed("question_2[]"));
    expect(await fill(located.page, [location], [])).toEqual(changed("location"));
  });

  it("accepts empty and absent unanswered fields", async () => {
    const questions = [
      question("question_1", "text", [], false),
      question("question_2", "single_select", ["a"], false),
      question("question_3[]", "multi_select", ["a"], false),
      { ...question("location", "text", [], false), section: "location" as const },
      question("question_4", "textarea", [], false),
    ];

    expect(await fill(fakePage({ missing: ["question_4"] }).page, questions, [])).toBeUndefined();
  });
});

describe("verifies uploads", () => {
  const resume = { ...question("resume", "file"), kind: "resume" as const };

  const letter = {
    ...question("cover_letter", "file", [], false),
    kind: "cover_letter" as const,
    fields: [
      { name: "cover_letter", type: "file" as const, options: [] },
      { name: "cover_letter_text", type: "textarea" as const, options: [] },
    ],
  };

  const path = "/tmp/.uploads/carta-de-apresentacao.pdf";

  it("attaches the résumé and checks the attached file name", async () => {
    const { page, actions, waits } = fakePage();

    expect(await fill(page, [resume], [])).toBeUndefined();
    expect(steps(actions)).toEqual(['setFiles [id="resume"] /tmp/.uploads/curriculo.pdf']);
    expect(waits.at(-1)).toContain('"curriculo.pdf"');
  });

  it("attaches nothing in a rehearsal but still writes the cover letter", async () => {
    const { page, actions } = fakePage();

    const result = await fill(page, [resume, letter], [], {
      files: { ...files, coverLetter: path, coverLetterText: "Carta" },
      attach: false,
    });

    const fileOnly = await fill(page, [{ ...letter, fields: [letter.fields[0]] }], [], {
      files: { ...files, coverLetter: path },
      attach: false,
    });

    expect(result).toBeUndefined();
    expect(fileOnly).toBeUndefined();
    expect(actions.some((action) => action.startsWith("setFiles"))).toBe(false);
    expect(steps(actions)).toEqual(['click [id="cover_letter_text"]', "type Carta"]);
  });

  it("reports an upload the form did not show", async () => {
    const { page } = fakePage({ rejectUpload: true });

    expect(await fill(page, [resume], [])).toEqual({ failed: "upload_failed", field: "resume" });
  });

  it("reports a missing file input", async () => {
    const { page, actions } = fakePage({ missing: ["resume"] });

    expect(await fill(page, [resume], [])).toEqual(changed("resume"));
    expect(steps(actions)).toEqual([]);
  });

  it("writes the cover letter into the text field after revealing it", async () => {
    const { page, actions } = fakePage({ hiddenLetter: true });

    const result = await fill(page, [letter], [], {
      files: { ...files, coverLetter: path, coverLetterText: "Olá,\nsou a Ana." },
    });

    expect(result).toBeUndefined();
    expect(steps(actions)).toEqual([
      'click [data-testid="cover_letter-text"]',
      'click [id="cover_letter_text"]',
      "type Olá,\nsou a Ana.",
    ]);
  });

  it("reports a cover letter text field that never appears", async () => {
    const { page } = fakePage({
      hiddenLetter: true,
      missing: ['[data-testid="cover_letter-text"]'],
    });

    expect(
      await fill(page, [letter], [], { files: { ...files, coverLetterText: "Carta" } }),
    ).toEqual(changed("cover_letter_text"));
  });

  it("uploads the cover letter file without text or a text field", async () => {
    const fileOnly = { ...letter, fields: [letter.fields[0]] };
    const text = fakePage();
    const upload = fakePage();

    expect(
      await fill(text.page, [fileOnly], [], {
        files: { ...files, coverLetter: path, coverLetterText: "Carta" },
      }),
    ).toBeUndefined();
    expect(steps(text.actions)).toEqual([`setFiles [id="cover_letter"] ${path}`]);
    expect(
      await fill(upload.page, [letter], [], { files: { ...files, coverLetter: path } }),
    ).toBeUndefined();
    expect(steps(upload.actions)).toEqual([`setFiles [id="cover_letter"] ${path}`]);
  });

  it("leaves the cover letter alone when there is none", async () => {
    const { page, actions } = fakePage();

    expect(await fill(page, [letter], [])).toBeUndefined();
    expect(steps(actions)).toEqual([]);
  });
});

describe("classifies the outcome", () => {
  it("lifts the guard and clicks the submit button", async () => {
    const { page, actions } = fakePage();

    expect(await submitGreenhouse(page)).toBe("clicked");
    expect(actions).toEqual(["lift", 'click #application-form button[type="submit"]']);
  });

  it("refuses to click on a page whose guard was never installed", async () => {
    const { page, actions } = fakePage({ unguarded: true });

    expect(await submitGreenhouse(page)).toBe("not_clicked");
    expect(actions).toEqual(["lift"]);
  });

  it("refuses to click while errors or a challenge are visible", async () => {
    for (const shown of [errored, challenged]) {
      const { page, actions } = fakePage({ pages: [shown] });

      expect(await submitGreenhouse(page)).toBe("not_clicked");
      expect(actions).toEqual([]);
    }
  });

  it("ignores the always-visible reCAPTCHA badge and a hidden challenge", () => {
    const hidden = { ...challenged, frames: [quiet.frames[0], { ...bframe, visible: false }] };

    expect(challengeVisible(quiet)).toBe(false);
    expect(classifyOutcome(quiet)).toBe("timeout");
    expect(classifyOutcome(hidden)).toBe("timeout");
  });

  it("sees a visible reCAPTCHA or hCaptcha challenge or the captcha message", () => {
    const hcaptcha = {
      ...quiet,
      frames: [
        { src: "https://newassets.hcaptcha.com/captcha/v1/x#frame=challenge", visible: true },
      ],
    };

    const message = {
      ...quiet,
      errors: [{ text: "Preencha o reCAPTCHA e reenvie seu cadastro", visible: true }],
    };

    expect(classifyOutcome(challenged)).toBe("blocked");
    expect(classifyOutcome(hcaptcha)).toBe("blocked");
    expect(classifyOutcome(message)).toBe("blocked");
  });

  it("sees visible field errors only", () => {
    const hidden = { ...quiet, errors: [{ text: "Este campo é obrigatório.", visible: false }] };
    const blank = { ...quiet, errors: [{ text: "", visible: true }] };

    expect(classifyOutcome(errored)).toBe("invalid");
    expect(classifyOutcome(hidden)).toBe("timeout");
    expect(classifyOutcome(blank)).toBe("timeout");
  });

  it("confirms from the confirmation URL or container, not from other page copy", () => {
    const container = { ...quiet, form: false, confirmations: confirmedPage.confirmations };

    const hiddenContainer = {
      ...container,
      confirmations: [{ text: "Recebemos sua inscrição.", visible: false }],
    };

    const unrelated = { ...container, confirmations: [{ text: "Carregando", visible: true }] };
    const spinner = { ...quiet, form: false, frames: [] };

    expect(classifyOutcome(confirmedPage)).toBe("confirmed");
    expect(classifyOutcome({ ...confirmedPage, confirmations: [] })).toBe("confirmed");
    expect(classifyOutcome(container)).toBe("confirmed");
    expect(classifyOutcome(hiddenContainer)).toBe("timeout");
    expect(classifyOutcome(unrelated)).toBe("timeout");
    expect(classifyOutcome(spinner)).toBe("timeout");
  });

  it("keeps waiting for confirmation past a transient challenge", async () => {
    const { page } = fakePage({ pages: [challenged, confirmedPage] });

    expect(await awaitOutcome(page, 30_000)).toBe("confirmed");
  });

  it("keeps waiting past a confirmation container without the copy", async () => {
    const loading = { ...quiet, confirmations: [{ text: "Carregando", visible: true }] };
    const { page, waits } = fakePage({ pages: [loading, confirmedPage] });

    expect(await awaitOutcome(page, 30_000)).toBe("confirmed");
    expect(waits).toHaveLength(2);
  });

  it("reports at the deadline what the page still shows", async () => {
    expect(await awaitOutcome(fakePage({ pages: [challenged] }).page, 30_000)).toBe("blocked");
    expect(await awaitOutcome(fakePage({ pages: [errored] }).page, 30_000)).toBe("invalid");
    expect(await awaitOutcome(fakePage().page, 30_000)).toBe("timeout");
  });

  it("sleeps between polls while a confirmation container lacks the copy", async () => {
    const loading = { ...quiet, confirmations: [{ text: "Carregando", visible: true }] };
    let polls = 0;

    const page: Page = {
      ...fakePage().page,
      async waitFor() {
        polls += 1;

        return true;
      },
      async evaluate(_expression, schema) {
        return schema.parse(loading);
      },
    };

    expect(await awaitOutcome(page, 600)).toBe("timeout");
    expect(polls).toBeGreaterThan(1);
    expect(polls).toBeLessThanOrEqual(4);
  });

  it("stops at the deadline even while a signal without the copy is shown", async () => {
    const loading = { ...quiet, confirmations: [{ text: "Carregando", visible: true }] };
    const { page } = fakePage({ pages: [loading, loading] });

    expect(await awaitOutcome(page, 0)).toBe("timeout");
  });
});

describe("checks the chosen city", () => {
  const state = { location: "São Paulo, Brazil", latitude: "-23.5", longitude: "-46.6" };

  it("matches the city ignoring case and accents", () => {
    expect(locationMatches(" sao paulo ", "São Paulo, Brazil", [state])).toBe(true);
    expect(locationMatches("São Paulo, SP", "São Paulo, Brazil", [state])).toBe(true);
    expect(
      locationMatches(" sao paulo ,sp", "São Paulo, State of São Paulo, Brazil", [
        { ...state, location: "São Paulo, State of São Paulo, Brazil" },
      ]),
    ).toBe(true);
  });

  it("requires the state of a city answer that names one", () => {
    const at = (location: string) => [{ ...state, location }];

    const bomJesus = "Bom Jesus, Piauí, Brazil";
    const gaucho = "Bom Jesus, Rio Grande do Sul, Brazil";
    const capital = "São Paulo, State of São Paulo, Brazil";
    const brasilia = "Brasília, Federal District, Brazil";

    expect(locationMatches("Bom Jesus, PI", bomJesus, at(bomJesus))).toBe(true);
    expect(locationMatches("Bom Jesus - pi", bomJesus, at(bomJesus))).toBe(true);
    expect(locationMatches("Bom Jesus, Piaui", bomJesus, at(bomJesus))).toBe(true);
    expect(locationMatches("Bom Jesus, PI", gaucho, at(gaucho))).toBe(false);
    expect(locationMatches("Bom Jesus - Piauí", gaucho, at(gaucho))).toBe(false);
    expect(locationMatches("Bom Jesus, PI", "Bom Jesus, Brazil", at("Bom Jesus, Brazil"))).toBe(
      false,
    );
    expect(locationMatches("Bom Jesus", gaucho, at(gaucho))).toBe(true);
    expect(locationMatches("Bom Jesus, Brasil", gaucho, at(gaucho))).toBe(true);
    expect(locationMatches("São Paulo, SP", capital, at(capital))).toBe(true);
    expect(locationMatches("Brasília - DF", brasilia, at(brasilia))).toBe(true);
    expect(
      locationMatches("Campo Grande, MT", "Campo Grande, Mato Grosso do Sul, Brazil", [
        { ...state, location: "Campo Grande, Mato Grosso do Sul, Brazil" },
      ]),
    ).toBe(false);
  });

  it("rejects another city, no value, a stale state or missing coordinates", () => {
    expect(locationMatches("São Paulo", "Sao Bernardo do Campo, Sao Paulo, Brazil", [state])).toBe(
      false,
    );
    expect(locationMatches("São Paulo", null, [state])).toBe(false);
    expect(locationMatches("São Paulo", "São Paulo, Brazil", [{ ...state, location: "Rio" }])).toBe(
      false,
    );
    expect(locationMatches("São Paulo", "São Paulo, Brazil", [{ ...state, latitude: " " }])).toBe(
      false,
    );
    expect(locationMatches("São Paulo", "São Paulo, Brazil", [{ ...state, longitude: "" }])).toBe(
      false,
    );
    expect(locationMatches("São Paulo", "São Paulo, Brazil", [])).toBe(false);
  });
});
