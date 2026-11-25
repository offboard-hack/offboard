import type { ConfirmedAnswer, FormQuestion } from "@offboard/db/schema";
import { z } from "zod";
import type { Page } from "./cdp.js";

export type LiveForm = {
  fields: { name: string; required: boolean; options: string[] }[];
  closed: boolean;
  loginRequired: boolean;
};

type Files = { resume: string; coverLetter: string | null; coverLetterText: string | null };

type FillInput = {
  questions: FormQuestion[];
  confirmed: ConfirmedAnswer[];
  account: { firstName: string; lastName: string; email: string };
  files: Files;
  phoneCountry: "BR";
};

type Failure = { failed: "upload_failed" | "form_changed"; field: string };

type Answer = string | string[] | null;

const readyMs = 20_000;
const menuMs = 5_000;
const suggestionMs = 10_000;
const coordinatesMs = 5_000;
const uploadMs = 15_000;
const revealMs = 3_000;

const locationControl = "candidate-location";
const letterField = "cover_letter_text";
const letterReveal = '[data-testid="cover_letter-text"]';
const submitButton = '#application-form button[type="submit"]';

const countries = { BR: { search: "Bra", names: ["brasil", "brazil"], code: "+55" } };

const signInPattern = /my\.greenhouse\.io|sign_in|\/login/;

const normalize = (text: string) =>
  text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

const digits = (text: string) => text.replace(/\D/g, "");

const byId = (id: string) => `[id=${JSON.stringify(id)}]`;

const found = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;

const listbox = (id: string) => byId(`react-select-${id}-listbox`);

const fail = (failed: Failure["failed"], field: string) => ({ failed, field }) satisfies Failure;

const readyExpression = `(() => { const form = document.querySelector("#application-form"); return form ? Object.keys(form).some((key) => key.startsWith("__react")) : document.readyState === "complete"; })()`;

const snapshotExpression = `(() => { const context = window.__remixContext ?? window.__reactRouterContext; const data = Object.values(context?.state?.loaderData ?? {}).find((entry) => Array.isArray(entry?.jobPost?.questions)); return { href: location.href, form: document.querySelector("#application-form") !== null, password: document.querySelector('input[type="password"]') !== null, questions: data ? data.jobPost.questions : null }; })()`;

const coordinatesExpression = `(() => { const form = document.querySelector("#application-form"); const key = form && Object.keys(form).find((name) => name.startsWith("__reactFiber")); const filled = (value) => value !== undefined && value !== null && String(value) !== ""; for (let fiber = key ? form[key] : null, depth = 0; fiber && depth < 100; fiber = fiber.return, depth += 1) { for (const node of [fiber, fiber.alternate]) { for (let hook = node?.memoizedState, index = 0; hook && typeof hook === "object" && index < 100; hook = hook.next, index += 1) { const state = hook.memoizedState; if (state && typeof state === "object" && "latitude" in state && "longitude" in state && filled(state.latitude) && filled(state.longitude)) return true; } } } return false; })()`;

const outcomeExpression = `(() => { const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth && element.checkVisibility({ opacityProperty: true, visibilityProperty: true }); }; const form = document.querySelector("#application-form"); const text = document.body?.innerText ?? ""; if (location.pathname.includes("/confirmation") || document.querySelector(".confirmation__content") || (!form && /recebemos sua inscri|agradecemos (sua inscri|o seu cadastro)|obrigad[oa] por se candidatar|candidatura (foi )?(realizada|enviada|recebida)|inscri[cç][aã]o (foi )?(realizada|enviada|recebida)|thank you for applying|thanks for applying|received your application|application (has been )?(received|submitted)/i.test(text))) return "confirmed"; const challenge = [...document.querySelectorAll("iframe")].some((frame) => (/\\/recaptcha\\/(api2|enterprise)\\/bframe/.test(frame.src) || /hcaptcha/.test(frame.src)) && visible(frame)); if (challenge || /preencha o recaptcha|complete the recaptcha/i.test(text)) return "blocked"; const errors = [...document.querySelectorAll(".helper-text--error, .flash-contents--extra-light-red")].some((item) => visible(item) && item.textContent.trim() !== ""); return errors ? "invalid" : null; })()`;

const liveQuestion = z.object({
  required: z.boolean(),
  fields: z.array(
    z.object({
      name: z.string(),
      values: z.array(z.object({ value: z.union([z.string(), z.number()]) })).nullish(),
    }),
  ),
});

const snapshot = z.object({
  href: z.string(),
  form: z.boolean(),
  password: z.boolean(),
  questions: z.array(liveQuestion).nullable().catch(null),
});

const menuOptions = z.array(z.object({ id: z.string(), text: z.string(), focused: z.boolean() }));

const outcome = z.enum(["confirmed", "blocked", "invalid"]).nullable();

const liveNames = (name: string) =>
  name === "candidate_location" ? ["location", "latitude", "longitude"] : [name];

export const readLiveForm = async (page: Page) => {
  await page.waitFor(readyExpression, readyMs);

  const live = await page.evaluate(snapshotExpression, snapshot);
  const loginRequired = !live.form && (live.password || signInPattern.test(live.href));

  const fields = (live.form ? (live.questions ?? []) : []).flatMap((item) =>
    item.fields.flatMap((field) =>
      liveNames(field.name).map((name) => ({
        name,
        required: item.required,
        options: (field.values ?? []).map((option) => String(option.value)),
      })),
    ),
  );

  return { fields, closed: !live.form && !loginRequired, loginRequired } satisfies LiveForm;
};

const chosenValues = (value: Answer | undefined) =>
  value === null || value === undefined ? [] : [value].flat();

export const checkForm = (
  live: LiveForm,
  questions: FormQuestion[],
  confirmed: ConfirmedAnswer[],
) => {
  const fields = new Map(live.fields.map((field) => [field.name, field]));
  const known = new Set(questions.flatMap((item) => item.fields.map((field) => field.name)));
  const values = new Map(confirmed.map((answer) => [answer.questionId, answer.value]));

  if (live.fields.some((field) => field.required && !known.has(field.name))) return "form_changed";

  for (const item of questions) {
    const [first] = item.fields;
    const chosen = chosenValues(values.get(item.id));
    const field = first === undefined ? undefined : fields.get(first.name);

    if (field === undefined) {
      if (item.required || chosen.length > 0) return "form_changed";

      continue;
    }

    if (field.required && !item.required) return "form_changed";

    const select = first?.type === "single_select" || first?.type === "multi_select";

    if (select && chosen.some((value) => !field.options.includes(value))) return "form_changed";
  }

  return "ok";
};

const exists = (page: Page, selector: string) =>
  page.evaluate(`${found(selector)} !== null`, z.boolean());

const sameText = (typed: string, kept: string) => normalize(typed) === normalize(kept);

const sameDigits = (typed: string, kept: string) => digits(typed) === digits(kept);

const typeInto = async (page: Page, id: string, text: string, same = sameText) => {
  const selector = byId(id);

  if (!(await exists(page, selector))) return fail("form_changed", id);

  await page.click(selector);
  await page.type(text);

  const kept = await page.evaluate(`${found(selector)}?.value ?? null`, z.string().nullable());

  return kept !== null && same(text, kept) ? undefined : fail("form_changed", id);
};

type Choice = {
  field: string;
  search: string;
  pick(text: string): boolean;
  shows(text: string): boolean;
};

const choose = async (page: Page, id: string, choice: Choice) => {
  const selector = byId(id);

  if (!(await exists(page, selector))) return fail("form_changed", choice.field);

  await page.click(selector);
  await page.type(choice.search);
  await page.waitFor(`${found(listbox(id))} !== null`, menuMs);

  const options = await page.evaluate(
    `(() => { const active = ${found(selector)}?.getAttribute("aria-activedescendant") ?? ""; return [...document.querySelectorAll(${JSON.stringify(`${listbox(id)} [role="option"]`)})].map((option) => ({ id: option.id, text: option.textContent ?? "", focused: option.id === active })); })()`,
    menuOptions,
  );

  const match = options.find((option) => choice.pick(option.text));

  if (match === undefined) {
    await page.press("Escape");

    return fail("form_changed", choice.field);
  }

  if (match.focused) await page.press("Enter");
  else await page.click(byId(match.id));

  const shown = await page.evaluate(
    `${found(selector)}?.closest(".select__control")?.querySelector(".select__single-value")?.textContent ?? null`,
    z.string().nullable(),
  );

  return shown !== null && choice.shows(shown) ? undefined : fail("form_changed", choice.field);
};

const chooseLabel = (page: Page, id: string, label: string) =>
  choose(page, id, {
    field: id,
    search: label,
    pick: (text) => sameText(label, text),
    shows: (text) => sameText(label, text),
  });

const fillPhone = async (page: Page, number: string, country: FillInput["phoneCountry"]) => {
  const { search, names, code } = countries[country];

  if (await exists(page, byId("country"))) {
    const failure = await choose(page, "country", {
      field: "country",
      search,
      pick: (text) => names.some((name) => normalize(text) === `${name} ${code}`),
      shows: (text) => normalize(text).includes(code),
    });

    if (failure !== undefined) return failure;
  }

  return typeInto(page, "phone", number, sameDigits);
};

const fillLocation = async (page: Page, city: string) => {
  const selector = byId(locationControl);
  const first = byId(`react-select-${locationControl}-option-0`);

  if (!(await exists(page, selector))) return fail("form_changed", "location");

  await page.click(selector);
  await page.type(city);

  if (!(await page.waitFor(`${found(first)} !== null`, suggestionMs))) {
    await page.press("Escape");

    return fail("form_changed", "location");
  }

  await page.click(first);

  return (await page.waitFor(coordinatesExpression, coordinatesMs))
    ? undefined
    : fail("form_changed", "location");
};

const tick = async (page: Page, name: string, values: string[]) => {
  for (const value of values) {
    const selector = byId(`${name}_${value}`);

    const checked = await page.evaluate(
      `${found(selector)}?.checked ?? null`,
      z.boolean().nullable(),
    );

    if (checked === null) return fail("form_changed", name);

    if (!checked) await page.click(selector);
  }

  const ticked = await page.evaluate(
    `[...document.querySelectorAll(${JSON.stringify(`input[type="checkbox"][name=${JSON.stringify(name)}]`)})].flatMap((box) => (box.checked ? [box.value] : []))`,
    z.array(z.string()),
  );

  const same = ticked.length === values.length && values.every((value) => ticked.includes(value));

  return same ? undefined : fail("form_changed", name);
};

const attach = async (page: Page, name: string, path: string) => {
  const selector = byId(name);
  const file = path.slice(path.lastIndexOf("/") + 1);

  if (!(await exists(page, selector))) return fail("form_changed", name);

  await page.setFiles(selector, [path]);

  const shown = await page.waitFor(
    `[...document.querySelectorAll(${JSON.stringify(`[aria-labelledby="upload-label-${name}"] .file-upload__filename`)})].some((item) => item.textContent.includes(${JSON.stringify(file)}))`,
    uploadMs,
  );

  return shown ? undefined : fail("upload_failed", name);
};

const fillCoverLetter = async (page: Page, question: FormQuestion, files: Files) => {
  const writable = question.fields.some((field) => field.name === letterField);

  if (files.coverLetterText !== null && writable) {
    if (!(await exists(page, byId(letterField)))) {
      if (await exists(page, letterReveal)) await page.click(letterReveal);

      if (!(await page.waitFor(`${found(byId(letterField))} !== null`, revealMs))) {
        return fail("form_changed", letterField);
      }
    }

    return typeInto(page, letterField, files.coverLetterText);
  }

  if (files.coverLetter !== null) return attach(page, "cover_letter", files.coverLetter);
};

const fillAnswer = (page: Page, question: FormQuestion, value: Answer, input: FillInput) => {
  const [first] = question.fields;

  if (first === undefined || value === null) return;

  const many = [value].flat();
  const single = Array.isArray(value) ? undefined : value;

  if (first.type === "multi_select") return tick(page, first.name, many);

  if (single === undefined) return fail("form_changed", first.name);

  if (first.name === "phone") return fillPhone(page, single, input.phoneCountry);

  if (first.name === "location") return fillLocation(page, single);

  if (first.type !== "single_select") return typeInto(page, first.name, single);

  const label = first.options.find((option) => option.value === single)?.label;

  return label === undefined
    ? fail("form_changed", first.name)
    : chooseLabel(page, first.name, label);
};

const fillQuestion = (page: Page, question: FormQuestion, value: Answer, input: FillInput) => {
  const [first] = question.fields;
  const { account, files } = input;

  if (first === undefined || question.fields.every((field) => field.type === "hidden")) return;

  if (first.name === "first_name") return typeInto(page, first.name, account.firstName);

  if (first.name === "last_name") return typeInto(page, first.name, account.lastName);

  if (first.name === "email") return typeInto(page, first.name, account.email);

  if (first.name === "resume") return attach(page, first.name, files.resume);

  if (first.name === "cover_letter") return fillCoverLetter(page, question, files);

  if (first.type === "file") return;

  return fillAnswer(page, question, value, input);
};

export const fillGreenhouse = async (page: Page, input: FillInput) => {
  const values = new Map(input.confirmed.map((answer) => [answer.questionId, answer.value]));

  for (const question of input.questions) {
    const failure = await fillQuestion(page, question, values.get(question.id) ?? null, input);

    if (failure !== undefined) return failure;
  }
};

export const submitGreenhouse = (page: Page) => page.click(submitButton);

export const awaitOutcome = async (page: Page, timeoutMs: number) => {
  if (!(await page.waitFor(`${outcomeExpression} !== null`, timeoutMs))) return "timeout";

  return (await page.evaluate(outcomeExpression, outcome)) ?? "timeout";
};
