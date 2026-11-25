import { readFileSync } from "node:fs";
import type { ConfirmedAnswer, FormQuestion } from "@offboard/db/schema";
import { describe, expect, it } from "vitest";
import { readGreenhouseForm } from "../greenhouse.js";
import type { Page } from "./cdp.js";
import {
  awaitOutcome,
  checkForm,
  fillGreenhouse,
  readLiveForm,
  submitGreenhouse,
  type LiveForm,
} from "./greenhouse-form.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

const stoneApi = fixture("greenhouse-stone.json");
const stoneLive = JSON.parse(fixture("greenhouse-stone-live.json")).questions;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type Outcome = "confirmed" | "blocked" | "invalid" | null;

type Setup = {
  missing?: string[];
  menus?: Record<string, string[]>;
  suggestions?: string[];
  coordinates?: boolean;
  rejectUpload?: boolean;
  readBack?: (id: string, typed: string) => string;
  shownAs?: Record<string, string>;
  checked?: string[];
  stuck?: string[];
  hiddenLetter?: boolean;
  menuDelay?: boolean;
  snapshot?: { href?: string; form?: boolean; password?: boolean; questions?: Json };
  outcomes?: Outcome[];
};

const countries = ["Brasil +55", "Gibraltar +350", "Portugal +351"];

const fakePage = (setup: Setup = {}) => {
  const actions: string[] = [];
  const waits: string[] = [];
  const values = new Map<string, string>();
  const shown = new Map<string, string>();
  const checked = new Set(setup.checked ?? []);
  const attached = new Map<string, string>();
  const menus = new Map(Object.entries({ country: countries, ...setup.menus }));
  const outcomes = [...(setup.outcomes ?? [])];
  let revealed = !setup.hiddenLetter;
  let focused = "";
  let search = "";
  let located = false;

  const idOf = (selector: string) =>
    selector.startsWith("[id=") ? JSON.parse(selector.slice(4, -1)) : selector;

  const present = (id: string) =>
    !(setup.missing ?? []).includes(id) && (id !== "cover_letter_text" || revealed);

  const literal = (expression: string) => {
    const match = /querySelector(?:All)?\(("(?:[^"\\]|\\.)*")\)/.exec(expression);

    return match?.[1] === undefined ? "" : JSON.parse(match[1]);
  };

  const filtered = (id: string) => {
    const labels = id === "candidate-location" ? (setup.suggestions ?? []) : (menus.get(id) ?? []);

    return labels.flatMap((text, index) =>
      text.toLowerCase().includes(search.toLowerCase()) ? [{ text, index }] : [],
    );
  };

  const options = (id: string) => {
    const list = filtered(id);

    return list.map(({ text, index }) => ({
      id: `react-select-${id}-option-${index}`,
      text,
      focused: index === list[0]?.index,
    }));
  };

  const coordinates = () => located && setup.coordinates !== false;

  const reply = (expression: string) => {
    if (expression.includes("loaderData")) {
      return {
        href: setup.snapshot?.href ?? "https://job-boards.greenhouse.io/stone/jobs/8201530003",
        form: setup.snapshot?.form ?? true,
        password: setup.snapshot?.password ?? false,
        questions: setup.snapshot?.questions === undefined ? stoneLive : setup.snapshot.questions,
      };
    }

    if (expression.includes("recaptcha")) return outcomes.shift() ?? null;

    if (expression.includes('[role=\\"option\\"]')) {
      return options(
        literal(expression)
          .split('"')[1]
          .replace(/^react-select-|-listbox$/g, ""),
      );
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

    if (expression.endsWith("?.checked ?? null")) return present(id) ? checked.has(id) : null;

    if (expression.endsWith("?.value ?? null")) return present(id) ? (values.get(id) ?? "") : null;

    throw new Error(`unexpected expression ${expression}`);
  };

  const ready = (expression: string) => {
    if (expression.includes("readyState")) return true;

    if (expression.includes("recaptcha")) return outcomes.length > 0;

    if (expression.includes("latitude")) return coordinates();

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

        const labels =
          owner === "candidate-location" ? (setup.suggestions ?? []) : (menus.get(owner) ?? []);

        shown.set(owner, labels[Number(option[2])] ?? "");
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

      if (key === "Enter") {
        const [first] = filtered(focused);

        if (first !== undefined) shown.set(focused, first.text);
      }
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
      return "https://job-boards.greenhouse.io/stone/jobs/8201530003";
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
  overrides: { files?: Files } = {},
) =>
  fillGreenhouse(page, {
    questions,
    confirmed,
    account,
    files: overrides.files ?? files,
    phoneCountry: "BR",
  });

const answers = (entries: Record<string, string | string[] | null>) =>
  Object.entries(entries).map(([questionId, value]) => ({ questionId, value }));

const live = (fields: LiveForm["fields"]) =>
  ({ fields, closed: false, loginRequired: false }) satisfies LiveForm;

describe("reads the live form", () => {
  it("reads the Stone form as it renders", async () => {
    const { page, waits } = fakePage();

    const form = await readLiveForm(page);

    expect(waits).toHaveLength(1);
    expect(form.closed).toBe(false);
    expect(form.loginRequired).toBe(false);
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

  it("detects a closed job", async () => {
    const { page } = fakePage({
      snapshot: {
        href: "https://job-boards.greenhouse.io/stone?error=true",
        form: false,
        questions: null,
      },
    });

    expect(await readLiveForm(page)).toEqual({ fields: [], closed: true, loginRequired: false });
  });

  it("detects a sign-in wall", async () => {
    const password = fakePage({ snapshot: { form: false, password: true, questions: null } });

    const signIn = fakePage({
      snapshot: { href: "https://my.greenhouse.io/users/sign_in", form: false, questions: null },
    });

    expect(await readLiveForm(password.page)).toEqual({
      fields: [],
      closed: false,
      loginRequired: true,
    });
    expect(await readLiveForm(signIn.page)).toMatchObject({ closed: false, loginRequired: true });
  });

  it("reads no fields when the form data is missing or unreadable", async () => {
    const missing = fakePage({ snapshot: { questions: null } });
    const unreadable = fakePage({ snapshot: { questions: [{ label: "x" }] } });

    expect((await readLiveForm(missing.page)).fields).toEqual([]);
    expect((await readLiveForm(unreadable.page)).fields).toEqual([]);
    expect(checkForm(await readLiveForm(missing.page), await stoneQuestions(), [])).toBe(
      "form_changed",
    );
  });
});

describe("reports a changed form", () => {
  const choice = question("question_1", "single_select", ["Sim", "Não"]);
  const optional = question("question_2", "text", [], false);

  const base = [
    { name: "question_1", required: true, options: ["1", "2"] },
    { name: "question_2", required: false, options: [] },
  ];

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
    const fields = [{ ...base[0], name: "question_1", required: true, options: ["1"] }, base[1]];

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
    expect(checkForm(live([base[1]]), [choice], answers({ question_1: "1" }))).toBe("form_changed");
  });

  it("reports a removed optional question that has an answer", () => {
    expect(
      checkForm(live([base[0]]), [choice, optional], answers({ question_1: "1", question_2: "x" })),
    ).toBe("form_changed");
    expect(
      checkForm(
        live([base[0]]),
        [choice, optional],
        answers({ question_1: "1", question_2: null }),
      ),
    ).toBe("ok");
  });

  it("reports an optional question that became required", () => {
    const fields = [base[0], { ...base[1], name: "question_2", required: true, options: [] }];

    expect(
      checkForm(live(fields), [choice, optional], answers({ question_1: "1", question_2: "x" })),
    ).toBe("form_changed");
  });

  it("reports a required question without fields", () => {
    const document = { ...question("document:1", "file"), fields: [] };

    expect(checkForm(live([]), [document], [])).toBe("form_changed");
    expect(checkForm(live([]), [{ ...document, required: false }], [])).toBe("ok");
  });
});

describe("fills each field kind", () => {
  it("types text after clicking the field", async () => {
    const { page, actions } = fakePage();
    const text = question("question_35399730003", "text");

    expect(
      await fill(page, [text], answers({ question_35399730003: "123.456.789-00" })),
    ).toBeUndefined();
    expect(actions).toEqual(['click [id="question_35399730003"]', "type 123.456.789-00"]);
  });

  it("fills name and email from the account", async () => {
    const { page, actions } = fakePage();
    const questions = (await stoneQuestions()).slice(0, 3);

    expect(
      await fill(
        page,
        questions,
        answers({ first_name: "Outra", last_name: "Pessoa", email: "x@y.z" }),
      ),
    ).toBeUndefined();
    expect(actions).toEqual([
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
    expect(actions).toEqual([]);
  });

  it("types the confirmed option's label into a combobox and presses Enter on a match", async () => {
    const { page, actions } = fakePage({
      menus: { question_1: ["Ensino médio incompleto", "Ensino médio completo"] },
    });

    const choice = question("question_1", "single_select", [
      "Ensino médio incompleto",
      "Ensino médio completo",
    ]);

    expect(await fill(page, [choice], answers({ question_1: "2" }))).toBeUndefined();
    expect(actions).toEqual([
      'click [id="question_1"]',
      "type Ensino médio completo",
      "press Enter",
    ]);
  });

  it("clicks the exact option when the highlighted one is a different option", async () => {
    const { page, actions } = fakePage({ menus: { question_1: ["Sim, com certeza", "Sim"] } });
    const choice = question("question_1", "single_select", ["Sim, com certeza", "Sim"]);

    expect(await fill(page, [choice], answers({ question_1: "2" }))).toBeUndefined();
    expect(actions).toEqual([
      'click [id="question_1"]',
      "type Sim",
      'click [id="react-select-question_1-option-1"]',
    ]);
  });

  it("never presses Enter when no option matches the label", async () => {
    const { page, actions } = fakePage({ menus: { question_1: ["Yes", "No"] } });
    const choice = question("question_1", "single_select", ["Sim", "Não"]);

    expect(await fill(page, [choice], answers({ question_1: "1" }))).toEqual({
      failed: "form_changed",
      field: "question_1",
    });
    expect(actions).toEqual(['click [id="question_1"]', "type Sim", "press Escape"]);
  });

  it("reports a combobox that shows another value", async () => {
    const { page } = fakePage({ menus: { question_1: ["Sim"] }, shownAs: { question_1: "Não" } });
    const choice = question("question_1", "single_select", ["Sim"]);

    expect(await fill(page, [choice], answers({ question_1: "1" }))).toEqual({
      failed: "form_changed",
      field: "question_1",
    });
  });

  it("reports a combobox that shows nothing or whose menu never opens", async () => {
    const choice = question("question_1", "single_select", ["Sim"]);
    const silent = fakePage({ menus: { question_1: [] } });
    const late = fakePage({ menus: { question_1: ["Sim"] }, menuDelay: true });

    expect(await fill(silent.page, [choice], answers({ question_1: "1" }))).toEqual({
      failed: "form_changed",
      field: "question_1",
    });
    expect(await fill(late.page, [choice], answers({ question_1: "1" }))).toBeUndefined();
  });

  it("reports a missing combobox without touching the page", async () => {
    const { page, actions } = fakePage({ missing: ["question_1"] });
    const choice = question("question_1", "single_select", ["Sim"]);

    expect(await fill(page, [choice], answers({ question_1: "1" }))).toEqual({
      failed: "form_changed",
      field: "question_1",
    });
    expect(actions).toEqual([]);
  });

  it("reports a confirmed value that is not an option", async () => {
    const { page, actions } = fakePage({ menus: { question_1: ["Sim"] } });
    const choice = question("question_1", "single_select", ["Sim"]);

    expect(await fill(page, [choice], answers({ question_1: "9" }))).toEqual({
      failed: "form_changed",
      field: "question_1",
    });
    expect(actions).toEqual([]);
  });

  it("ticks each confirmed checkbox", async () => {
    const { page, actions } = fakePage();
    const group = question("question_4[]", "multi_select", ["a", "b", "c"]);

    expect(await fill(page, [group], answers({ "question_4[]": ["1", "3"] }))).toBeUndefined();
    expect(actions).toEqual(['click [id="question_4[]_1"]', 'click [id="question_4[]_3"]']);
  });

  it("leaves a checkbox that is already ticked", async () => {
    const { page, actions } = fakePage({ checked: ["question_4[]_1"] });
    const group = question("question_4[]", "multi_select", ["a", "b"]);

    expect(await fill(page, [group], answers({ "question_4[]": ["1"] }))).toBeUndefined();
    expect(actions).toEqual([]);
  });

  it("reports a checkbox that is missing, stuck, or an extra tick", async () => {
    const group = question("question_4[]", "multi_select", ["a", "b"]);
    const failure = { failed: "form_changed", field: "question_4[]" };

    const missing = fakePage({ missing: ["question_4[]_2"] });
    const stuck = fakePage({ stuck: ["question_4[]_1"] });
    const extra = fakePage({ checked: ["question_4[]_2"] });

    expect(await fill(missing.page, [group], answers({ "question_4[]": ["2"] }))).toEqual(failure);
    expect(await fill(stuck.page, [group], answers({ "question_4[]": ["1"] }))).toEqual(failure);
    expect(await fill(extra.page, [group], answers({ "question_4[]": ["1"] }))).toEqual(failure);
  });

  it("chooses Brazil for the phone and types the confirmed number", async () => {
    const { page, actions } = fakePage();
    const [phone] = (await stoneQuestions()).filter((item) => item.kind === "phone");

    if (phone === undefined) throw new Error("phone");

    expect(await fill(page, [phone], answers({ phone: "+55 11 91234-5678" }))).toBeUndefined();
    expect(actions).toEqual([
      'click [id="country"]',
      "type Bra",
      "press Enter",
      'click [id="phone"]',
      "type +55 11 91234-5678",
    ]);
  });

  it("accepts a phone the form reformats and skips an empty phone", async () => {
    const { page, actions } = fakePage({ readBack: () => "(11) 91234-5678" });
    const phone = { ...question("phone", "text"), kind: "phone" as const };

    expect(await fill(page, [phone], answers({ phone: "11 91234 5678" }))).toBeUndefined();
    expect(await fill(page, [phone], answers({ phone: null }))).toBeUndefined();
    expect(actions.filter((action) => action.startsWith("type"))).toEqual([
      "type Bra",
      "type 11 91234 5678",
    ]);
  });

  it("clicks Brazil when it is not highlighted and types a phone without a country control", async () => {
    const highlighted = fakePage({ menus: { country: ["Gibraltar +350", "Brazil +55"] } });
    const plain = fakePage({ missing: ["country"] });
    const phone = { ...question("phone", "text"), kind: "phone" as const };

    expect(await fill(highlighted.page, [phone], answers({ phone: "11" }))).toBeUndefined();
    expect(highlighted.actions).toContain('click [id="react-select-country-option-1"]');
    expect(await fill(plain.page, [phone], answers({ phone: "11" }))).toBeUndefined();
    expect(plain.actions).toEqual(['click [id="phone"]', "type 11"]);
  });

  it("reports a phone country that is not offered or not shown", async () => {
    const phone = { ...question("phone", "text"), kind: "phone" as const };
    const absent = fakePage({ menus: { country: ["Gibraltar +350"] } });
    const other = fakePage({ shownAs: { country: "+350" } });

    expect(await fill(absent.page, [phone], answers({ phone: "11" }))).toEqual({
      failed: "form_changed",
      field: "country",
    });
    expect(await fill(other.page, [phone], answers({ phone: "11" }))).toEqual({
      failed: "form_changed",
      field: "country",
    });
  });

  it("reports text the form did not keep", async () => {
    const text = question("question_1", "text");
    const truncated = fakePage({ readBack: (_, typed) => typed.slice(0, 3) });
    const missing = fakePage({ missing: ["question_1"] });
    const wrong = { ...question("question_1", "text") };

    expect(await fill(truncated.page, [text], answers({ question_1: "abcdef" }))).toEqual({
      failed: "form_changed",
      field: "question_1",
    });
    expect(await fill(missing.page, [wrong], answers({ question_1: "abc" }))).toEqual({
      failed: "form_changed",
      field: "question_1",
    });
    expect(missing.actions).toEqual([]);
  });

  it("reports an answer whose shape does not fit the field", async () => {
    const { page } = fakePage();
    const failure = { failed: "form_changed", field: "question_1" };

    expect(
      await fill(page, [question("question_1", "text")], answers({ question_1: ["a"] })),
    ).toEqual(failure);
    expect(
      await fill(
        page,
        [question("question_1", "single_select", ["a"])],
        answers({ question_1: ["1"] }),
      ),
    ).toEqual(failure);
  });

  it("types the city and picks the first suggestion", async () => {
    const { page, actions } = fakePage({
      suggestions: ["São Paulo, Brazil", "Sao Bernardo do Campo, Sao Paulo, Brazil"],
    });

    const [location] = (await stoneQuestions()).filter((item) => item.id === "location");

    if (location === undefined) throw new Error("location");

    expect(await fill(page, [location], answers({ location: "São Paulo" }))).toBeUndefined();
    expect(actions).toEqual([
      'click [id="candidate-location"]',
      "type São Paulo",
      'click [id="react-select-candidate-location-option-0"]',
    ]);
  });

  it("reports a city without suggestions, coordinates or a control", async () => {
    const location = {
      ...question("location", "text"),
      section: "location" as const,
      kind: "city" as const,
    };

    const failure = { failed: "form_changed", field: "location" };

    const none = fakePage({ suggestions: [] });
    const nowhere = fakePage({ suggestions: ["São Paulo, Brazil"], coordinates: false });
    const missing = fakePage({ missing: ["candidate-location"] });

    expect(await fill(none.page, [location], answers({ location: "Xyz" }))).toEqual(failure);
    expect(none.actions.at(-1)).toBe("press Escape");
    expect(await fill(nowhere.page, [location], answers({ location: "São Paulo" }))).toEqual(
      failure,
    );
    expect(await fill(missing.page, [location], answers({ location: "São Paulo" }))).toEqual(
      failure,
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
    expect(actions).not.toContain('click [id="cover_letter"]');
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

  it("attaches the résumé and checks the attached file name", async () => {
    const { page, actions, waits } = fakePage();

    expect(await fill(page, [resume], [])).toBeUndefined();
    expect(actions).toEqual(['setFiles [id="resume"] /tmp/.uploads/curriculo.pdf']);
    expect(waits.at(-1)).toContain('"curriculo.pdf"');
  });

  it("reports an upload the form did not show", async () => {
    const { page } = fakePage({ rejectUpload: true });

    expect(await fill(page, [resume], [])).toEqual({ failed: "upload_failed", field: "resume" });
  });

  it("reports a missing file input", async () => {
    const { page, actions } = fakePage({ missing: ["resume"] });

    expect(await fill(page, [resume], [])).toEqual({ failed: "form_changed", field: "resume" });
    expect(actions).toEqual([]);
  });

  it("writes the cover letter into the text field after revealing it", async () => {
    const { page, actions } = fakePage({ hiddenLetter: true });

    const result = await fill(page, [letter], [], {
      files: {
        ...files,
        coverLetter: "/tmp/.uploads/carta-de-apresentacao.pdf",
        coverLetterText: "Olá,\nsou a Ana.",
      },
    });

    expect(result).toBeUndefined();
    expect(actions).toEqual([
      'click [data-testid="cover_letter-text"]',
      'click [id="cover_letter_text"]',
      "type Olá,\nsou a Ana.",
    ]);
  });

  it("writes into a text field that is already shown", async () => {
    const { page, actions } = fakePage();

    await fill(page, [letter], [], { files: { ...files, coverLetterText: "Carta" } });

    expect(actions).toEqual(['click [id="cover_letter_text"]', "type Carta"]);
  });

  it("reports a cover letter text field that never appears", async () => {
    const { page } = fakePage({
      hiddenLetter: true,
      missing: ['[data-testid="cover_letter-text"]'],
    });

    expect(
      await fill(page, [letter], [], { files: { ...files, coverLetterText: "Carta" } }),
    ).toEqual({
      failed: "form_changed",
      field: "cover_letter_text",
    });
  });

  it("uploads the cover letter file without text or a text field", async () => {
    const fileOnly = { ...letter, fields: [letter.fields[0]] };
    const path = "/tmp/.uploads/carta-de-apresentacao.pdf";
    const text = fakePage();
    const upload = fakePage();

    expect(
      await fill(text.page, [fileOnly], [], {
        files: { ...files, coverLetter: path, coverLetterText: "Carta" },
      }),
    ).toBeUndefined();
    expect(text.actions).toEqual([`setFiles [id="cover_letter"] ${path}`]);
    expect(
      await fill(upload.page, [letter], [], { files: { ...files, coverLetter: path } }),
    ).toBeUndefined();
    expect(upload.actions).toEqual([`setFiles [id="cover_letter"] ${path}`]);
  });

  it("leaves the cover letter alone when there is none", async () => {
    const { page, actions } = fakePage();

    expect(await fill(page, [letter], [])).toBeUndefined();
    expect(actions).toEqual([]);
  });
});

describe("classifies the outcome", () => {
  it("clicks the submit button", async () => {
    const { page, actions } = fakePage();

    await submitGreenhouse(page);

    expect(actions).toEqual(['click #application-form button[type="submit"]']);
  });

  it("reports what the page shows after the click", async () => {
    for (const outcome of ["confirmed", "blocked", "invalid"] as const) {
      const { page } = fakePage({ outcomes: [outcome] });

      expect(await awaitOutcome(page, 30_000)).toBe(outcome);
    }
  });

  it("times out when nothing shows", async () => {
    const { page, waits } = fakePage();

    expect(await awaitOutcome(page, 30_000)).toBe("timeout");
    expect(waits).toHaveLength(1);
  });

  it("times out when the signal disappears before it is read", async () => {
    const { page } = fakePage({ outcomes: [null] });

    expect(await awaitOutcome(page, 30_000)).toBe("timeout");
  });
});
