import type { ConfirmedAnswer, FormField, FormQuestion } from "@offboard/db/schema";
import { z } from "zod";
import type { Page } from "./cdp.js";

export type LiveForm = {
  fields: { name: string; required: boolean; options: string[] }[];
  ready: boolean;
  closed: boolean;
  loginRequired: boolean;
  blocked: boolean;
};

type Files = { resume: string; coverLetter: string | null; coverLetterText: string | null };

type FillInput = {
  questions: FormQuestion[];
  confirmed: ConfirmedAnswer[];
  account: { firstName: string; lastName: string; email: string };
  files: Files;
  phoneCountry: "BR";
  attach: boolean;
};

type Failure = { failed: "upload_failed" | "fill_failed"; field: string };

type Answer = string | string[] | null;

const readyMs = 20_000;
const menuMs = 5_000;
const suggestionMs = 10_000;
const coordinatesMs = 5_000;
const uploadMs = 15_000;
const revealMs = 3_000;
const outcomePollMs = 250;

const locationControl = "candidate-location";
const letterField = "cover_letter_text";
const letterReveal = '[data-testid="cover_letter-text"]';
const submitButton = '#application-form button[type="submit"]';
const demographicPrefix = "demographic:";

const countries = { BR: { search: "Bra", names: ["brasil", "brazil"], code: "+55" } };

const controlNames = new Map([
  [locationControl, "location"],
  ["country", "phone"],
]);

const signInPattern = /my\.greenhouse\.io|sign_in|\/login/;

const closedPattern =
  /no longer open|n[aã]o est[aá] mais aberta|page not found|p[aá]gina n[aã]o encontrada|\b404\b/i;

const confirmationPattern =
  /recebemos sua inscri|agradecemos (sua inscri|o seu cadastro)|obrigad[oa] por se candidatar|candidatura (foi )?(realizada|enviada|recebida)|inscri[cç][aã]o (foi )?(realizada|enviada|recebida)|thank you for applying|thanks for applying|received your application|application (has been )?(received|submitted)/i;

const challengePattern = /\/recaptcha\/(api2|enterprise)\/bframe|hcaptcha/;

const captchaCopyPattern = /preencha o recaptcha|complete the recaptcha/i;

const normalize = (text: string) =>
  text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

const loose = (text: string) => normalize(text).normalize("NFD").replace(/\p{M}/gu, "");

const digits = (text: string) => text.replace(/\D/g, "");

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const byId = (id: string) => `[id=${JSON.stringify(id)}]`;

const found = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;

const listbox = (id: string) => byId(`react-select-${id}-listbox`);

const fail = (failed: Failure["failed"], field: string) => ({ failed, field }) satisfies Failure;

const visibility = `const shown = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && element.checkVisibility({ opacityProperty: true, visibilityProperty: true }); }; const onScreen = (element) => { const box = element.getBoundingClientRect(); return shown(element) && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth; }; const text = (element) => (element.innerText ?? element.textContent ?? "").trim().slice(0, 500);`;

const readyExpression = `(() => { const form = document.querySelector("#application-form"); return form ? Object.keys(form).some((key) => key.startsWith("__react")) : document.readyState === "complete"; })()`;

const formPageExpression = `(() => { const context = window.__remixContext ?? window.__reactRouterContext; const data = Object.values(context?.state?.loaderData ?? {}).find((entry) => Array.isArray(entry?.jobPost?.questions)); const form = document.querySelector("#application-form"); return { href: location.href, form: form !== null, password: document.querySelector('input[type="password"]') !== null, title: document.title, notices: [...document.querySelectorAll('[class*="flash"], h1, h2')].slice(0, 20).map((item) => (item.textContent ?? "").trim()), questions: data ? data.jobPost.questions : null, demographics: data ? (data.jobPost.demographic_questions?.questions ?? []) : null, required: form ? [...form.querySelectorAll('[aria-required="true"], [required]')].map((item) => ({ id: item.id ?? "", name: item.getAttribute("name") ?? "", labelledBy: item.getAttribute("aria-labelledby") ?? "" })) : [] }; })()`;

const locationStatesExpression = `(() => { const form = document.querySelector("#application-form"); const key = form && Object.keys(form).find((name) => name.startsWith("__reactFiber")); const states = []; for (let fiber = key ? form[key] : null, depth = 0; fiber && depth < 100; fiber = fiber.return, depth += 1) { for (const node of [fiber, fiber.alternate]) { for (let hook = node?.memoizedState, index = 0; hook && typeof hook === "object" && index < 100; hook = hook.next, index += 1) { const state = hook.memoizedState; if (state && typeof state === "object" && "latitude" in state && "longitude" in state) states.push({ location: String(state.location ?? ""), latitude: String(state.latitude ?? ""), longitude: String(state.longitude ?? "") }); } } } return states.slice(0, 10); })()`;

const outcomeExpression = `(() => { ${visibility} return { path: location.pathname, form: document.querySelector("#application-form") !== null, frames: [...document.querySelectorAll("iframe")].map((frame) => ({ src: frame.src, visible: onScreen(frame) })), errors: [...document.querySelectorAll(".helper-text--error, .flash-contents--extra-light-red")].map((item) => ({ text: text(item), visible: shown(item) })), confirmations: [...document.querySelectorAll('.confirmation__content, [class*="confirmation"]')].slice(0, 20).map((item) => ({ text: text(item), visible: shown(item) })) }; })()`;

const confirmationSignal = `location.pathname.includes("/confirmation") || document.querySelector(".confirmation__content") !== null`;

const guardExpression = `(() => { const submits = 'button[type="submit"], input[type="submit"], #application-form button:not([type])'; if (!window.__offboardGuard) { const guard = { armed: true }; window.__offboardGuard = guard; const stop = (event) => { event.preventDefault(); event.stopImmediatePropagation(); }; window.addEventListener("submit", (event) => { if (guard.armed) stop(event); }, true); window.addEventListener("click", (event) => { if (guard.armed && event.target instanceof Element && event.target.closest(submits)) stop(event); }, true); const { submit, requestSubmit } = HTMLFormElement.prototype; HTMLFormElement.prototype.submit = function () { if (!guard.armed) submit.call(this); }; HTMLFormElement.prototype.requestSubmit = function (submitter) { if (!guard.armed) requestSubmit.call(this, submitter); }; } window.__offboardGuard.armed = true; return true; })()`;

const liftExpression = `(() => { if (!window.__offboardGuard) return false; window.__offboardGuard.armed = false; return true; })()`;

const liveQuestion = z.object({
  required: z.boolean(),
  fields: z.array(
    z.object({
      name: z.string(),
      values: z.array(z.object({ value: z.union([z.string(), z.number()]) })).nullish(),
    }),
  ),
});

const liveDemographic = z.object({
  id: z.union([z.string(), z.number()]),
  required: z.boolean(),
  answer_options: z.array(z.object({ id: z.union([z.string(), z.number()]) })).nullish(),
});

const formPage = z.object({
  href: z.string(),
  form: z.boolean(),
  password: z.boolean(),
  title: z.string(),
  notices: z.array(z.string()),
  questions: z.array(liveQuestion).nullable().catch(null),
  demographics: z.array(liveDemographic).nullish().catch(null),
  required: z.array(z.object({ id: z.string(), name: z.string(), labelledBy: z.string() })),
});

export type FormPage = z.infer<typeof formPage>;

const visibleText = z.object({ text: z.string(), visible: z.boolean() });

const outcomePage = z.object({
  path: z.string(),
  form: z.boolean(),
  frames: z.array(z.object({ src: z.string(), visible: z.boolean() })),
  errors: z.array(visibleText),
  confirmations: z.array(visibleText),
});

export type OutcomePage = z.infer<typeof outcomePage>;

const locationStates = z.array(
  z.object({ location: z.string(), latitude: z.string(), longitude: z.string() }),
);

export type LocationState = z.infer<typeof locationStates>[number];

const menuOptions = z.array(z.object({ id: z.string(), text: z.string() }));

const liveNames = (name: string) =>
  name === "candidate_location" ? ["location", "latitude", "longitude"] : [name];

const controlOf = (name: string) =>
  name.startsWith(demographicPrefix) ? name.slice(demographicPrefix.length) : name;

const controlName = (control: FormPage["required"][number]) => {
  if (control.name.endsWith("[]")) return control.name;

  if (control.id !== "") return controlNames.get(control.id) ?? control.id;

  if (control.name !== "") return control.name;

  return /^upload-label-(.+)$/.exec(control.labelledBy)?.[1];
};

export const liveFormFrom = (page: FormPage) => {
  if (!page.form) {
    const loginRequired = page.password || signInPattern.test(page.href);

    const closed =
      !loginRequired &&
      (/[?&]error=true/.test(page.href) ||
        [page.title, ...page.notices].some((text) => closedPattern.test(text)));

    return {
      fields: [],
      ready: true,
      closed,
      loginRequired,
      blocked: !closed && !loginRequired,
    } satisfies LiveForm;
  }

  const fields = (page.questions ?? []).flatMap((item) =>
    item.fields.flatMap((field) =>
      liveNames(field.name).map((name) => ({
        name,
        required: item.required,
        options: (field.values ?? []).map((option) => String(option.value)),
      })),
    ),
  );

  const demographics = (page.demographics ?? []).map((item) => ({
    name: `${demographicPrefix}${item.id}`,
    required: item.required,
    options: (item.answer_options ?? []).map((option) => String(option.id)),
  }));

  const known = new Set([...fields, ...demographics].map((field) => field.name));
  const controls = new Set(demographics.map((field) => controlOf(field.name)));

  const extra = [
    ...new Set(
      page.required.flatMap((control) => {
        const name = controlName(control);

        return name === undefined || known.has(name) || controls.has(name) ? [] : [name];
      }),
    ),
  ];

  return {
    fields: [
      ...fields,
      ...demographics,
      ...extra.map((name) => ({ name, required: true, options: [] })),
    ],
    ready: true,
    closed: false,
    loginRequired: false,
    blocked: false,
  } satisfies LiveForm;
};

export const readLiveForm = async (page: Page) => {
  if (!(await page.waitFor(readyExpression, readyMs))) {
    return {
      fields: [],
      ready: false,
      closed: false,
      loginRequired: false,
      blocked: false,
    } satisfies LiveForm;
  }

  return liveFormFrom(await page.evaluate(formPageExpression, formPage));
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

  if (!live.ready) return "form_changed";

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

export const challengeVisible = (page: OutcomePage) =>
  page.frames.some((frame) => frame.visible && challengePattern.test(frame.src)) ||
  page.errors.some((error) => error.visible && captchaCopyPattern.test(error.text));

export const errorsVisible = (page: OutcomePage) =>
  page.errors.some((error) => error.visible && error.text !== "");

export const classifyOutcome = (page: OutcomePage) => {
  const confirmed =
    page.path.includes("/confirmation") ||
    page.confirmations.some((item) => item.visible && confirmationPattern.test(item.text));

  if (confirmed) return "confirmed";

  if (challengeVisible(page)) return "blocked";

  return errorsVisible(page) ? "invalid" : "timeout";
};

const brazilStates = [
  ["AC", "Acre"],
  ["AL", "Alagoas"],
  ["AP", "Amapá"],
  ["AM", "Amazonas"],
  ["BA", "Bahia"],
  ["CE", "Ceará"],
  ["DF", "Distrito Federal", "Federal District"],
  ["ES", "Espírito Santo"],
  ["GO", "Goiás"],
  ["MA", "Maranhão"],
  ["MT", "Mato Grosso"],
  ["MS", "Mato Grosso do Sul"],
  ["MG", "Minas Gerais"],
  ["PA", "Pará"],
  ["PB", "Paraíba"],
  ["PR", "Paraná"],
  ["PE", "Pernambuco"],
  ["PI", "Piauí"],
  ["RJ", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte"],
  ["RS", "Rio Grande do Sul"],
  ["RO", "Rondônia"],
  ["RR", "Roraima"],
  ["SC", "Santa Catarina"],
  ["SP", "São Paulo"],
  ["SE", "Sergipe"],
  ["TO", "Tocantins"],
].map((names) => names.map(loose));

const placeParts = (place: string) => place.split(/,|\s-\s/).map((part) => part.trim());

const cityName = (place: string) => placeParts(place)[0];

const stateNamed = (place: string) => {
  const [, part = ""] = placeParts(place);

  return brazilStates.find((names) => names.includes(loose(part)));
};

const showsState = (shown: string, names: string[]) =>
  shown.split(",").some((part) => names.includes(loose(part).replace(/^state of /, "")));

export const locationMatches = (city: string, shown: string | null, states: LocationState[]) => {
  if (shown === null) return false;

  const state = stateNamed(city);

  return (
    loose(cityName(shown)) === loose(cityName(city)) &&
    (state === undefined || showsState(shown, state)) &&
    states.some(
      (state) =>
        state.latitude.trim() !== "" &&
        state.longitude.trim() !== "" &&
        loose(state.location) === loose(shown),
    )
  );
};

const exists = (page: Page, selector: string) =>
  page.evaluate(`${found(selector)} !== null`, z.boolean());

const valueOf = (page: Page, selector: string) =>
  page.evaluate(`${found(selector)}?.value ?? null`, z.string().nullable());

const shownIn = (page: Page, id: string) =>
  page.evaluate(
    `${found(byId(id))}?.closest(".select__control")?.querySelector(".select__single-value")?.textContent ?? null`,
    z.string().nullable(),
  );

const tickedIn = (page: Page, name: string) =>
  page.evaluate(
    `[...document.querySelectorAll(${JSON.stringify(`input[type="checkbox"][name=${JSON.stringify(name)}]`)})].flatMap((box) => (box.checked ? [box.value] : []))`,
    z.array(z.string()),
  );

const sameText = (typed: string, kept: string) => normalize(typed) === normalize(kept);

const sameDigits = (typed: string, kept: string) => digits(typed) === digits(kept);

const typeInto = async (page: Page, id: string, text: string, same = sameText) => {
  const selector = byId(id);
  const tag = await page.evaluate(`${found(selector)}?.tagName ?? null`, z.string().nullable());

  if (tag === null || (tag === "INPUT" && /[\r\n]/.test(text))) return fail("fill_failed", id);

  await page.click(selector);
  await page.type(text);

  const kept = await valueOf(page, selector);

  return kept !== null && same(text, kept) ? undefined : fail("fill_failed", id);
};

type Choice = {
  field: string;
  search: string;
  pick(text: string): boolean;
  shows?(text: string): boolean;
};

const choose = async (page: Page, id: string, choice: Choice) => {
  const selector = byId(id);

  if (!(await exists(page, selector))) return fail("fill_failed", choice.field);

  await page.click(selector);
  await page.type(choice.search);

  if (!(await page.waitFor(`${found(listbox(id))} !== null`, menuMs))) {
    await page.press("Escape");

    return fail("fill_failed", choice.field);
  }

  const options = await page.evaluate(
    `[...document.querySelectorAll(${JSON.stringify(`${listbox(id)} [role="option"]`)})].map((option) => ({ id: option.id, text: option.textContent ?? "" }))`,
    menuOptions,
  );

  const match = options.find((option) => choice.pick(option.text));

  if (match === undefined) {
    await page.press("Escape");

    return fail("fill_failed", choice.field);
  }

  await page.click(byId(match.id));

  if (choice.shows === undefined) return;

  const shown = await shownIn(page, id);

  return shown !== null && choice.shows(shown) ? undefined : fail("fill_failed", choice.field);
};

const chooseLabel = (page: Page, id: string, label: string, field = id) =>
  choose(page, id, {
    field,
    search: label,
    pick: (text) => sameText(label, text),
    shows: (text) => sameText(label, text),
  });

const chipsIn = (page: Page, id: string) =>
  page.evaluate(
    `[...(${found(byId(id))}?.closest(".select__control")?.querySelectorAll(".select__multi-value__label") ?? [])].map((chip) => chip.textContent ?? "")`,
    z.array(z.string()),
  );

const labelOf = (field: FormField, value: string) =>
  field.options.find((option) => option.value === value)?.label;

const chooseLabels = async (page: Page, field: FormField, values: string[]) => {
  const id = controlOf(field.name);
  const labels = values.map((value) => labelOf(field, value));

  for (const label of labels) {
    if (label === undefined) return fail("fill_failed", field.name);

    const failure = await choose(page, id, {
      field: field.name,
      search: label,
      pick: (text) => sameText(label, text),
    });

    if (failure !== undefined) return failure;
  }

  await page.press("Escape");

  const shown = await chipsIn(page, id);

  const same =
    shown.length === labels.length &&
    labels.every((label) => shown.some((text) => label !== undefined && sameText(label, text)));

  return same ? undefined : fail("fill_failed", field.name);
};

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

  if (!(await exists(page, selector))) return fail("fill_failed", "location");

  await page.click(selector);
  await page.type(cityName(city));

  if (!(await page.waitFor(`${found(first)} !== null`, suggestionMs))) {
    await page.press("Escape");

    return fail("fill_failed", "location");
  }

  await page.click(first);
  await page.waitFor(
    `${locationStatesExpression}.some((state) => state.latitude !== "" && state.longitude !== "")`,
    coordinatesMs,
  );

  const shown = await shownIn(page, locationControl);
  const states = await page.evaluate(locationStatesExpression, locationStates);

  return locationMatches(city, shown, states) ? undefined : fail("fill_failed", "location");
};

const tick = async (page: Page, name: string, values: string[]) => {
  for (const value of values) {
    const selector = byId(`${name}_${value}`);

    const checked = await page.evaluate(
      `${found(selector)}?.checked ?? null`,
      z.boolean().nullable(),
    );

    if (checked === null) return fail("fill_failed", name);

    if (!checked) await page.click(selector);
  }

  const ticked = await tickedIn(page, name);
  const same = ticked.length === values.length && values.every((value) => ticked.includes(value));

  return same ? undefined : fail("fill_failed", name);
};

const attachFile = async (page: Page, name: string, path: string) => {
  const selector = byId(name);
  const file = path.slice(path.lastIndexOf("/") + 1);

  if (!(await exists(page, selector))) return fail("fill_failed", name);

  await page.setFiles(selector, [path]);

  const shown = await page.waitFor(
    `[...document.querySelectorAll(${JSON.stringify(`[aria-labelledby="upload-label-${name}"] .file-upload__filename`)})].some((item) => item.textContent.includes(${JSON.stringify(file)}))`,
    uploadMs,
  );

  return shown ? undefined : fail("upload_failed", name);
};

const fillCoverLetter = async (page: Page, question: FormQuestion, input: FillInput) => {
  const { files } = input;
  const writable = question.fields.some((field) => field.name === letterField);

  if (files.coverLetterText !== null && writable) {
    if (!(await exists(page, byId(letterField)))) {
      if (await exists(page, letterReveal)) await page.click(letterReveal);

      if (!(await page.waitFor(`${found(byId(letterField))} !== null`, revealMs))) {
        return fail("fill_failed", letterField);
      }
    }

    return typeInto(page, letterField, files.coverLetterText);
  }

  if (files.coverLetter !== null && input.attach) {
    return attachFile(page, "cover_letter", files.coverLetter);
  }
};

const fillAnswer = (page: Page, question: FormQuestion, value: Answer, input: FillInput) => {
  const [first] = question.fields;

  if (first === undefined || value === null) return;

  const many = [value].flat();
  const single = Array.isArray(value) ? undefined : value;

  const demographic = first.name.startsWith(demographicPrefix);

  if (demographic && first.type === "multi_select") return chooseLabels(page, first, many);

  if (first.type === "multi_select") return tick(page, first.name, many);

  if (single === undefined) return fail("fill_failed", first.name);

  if (first.name === "phone") return fillPhone(page, single, input.phoneCountry);

  if (first.name === "location") return fillLocation(page, single);

  if (first.type !== "single_select") return typeInto(page, first.name, single);

  const label = labelOf(first, single);

  return label === undefined
    ? fail("fill_failed", first.name)
    : chooseLabel(page, controlOf(first.name), label, first.name);
};

const accountFields = new Set(["first_name", "last_name", "email"]);

const filledByDriver = (question: FormQuestion) => {
  const [first] = question.fields;

  return (
    first === undefined ||
    accountFields.has(first.name) ||
    first.type === "file" ||
    question.fields.every((field) => field.type === "hidden")
  );
};

const fillQuestion = (page: Page, question: FormQuestion, value: Answer, input: FillInput) => {
  const [first] = question.fields;
  const { account, files } = input;

  if (first === undefined || question.fields.every((field) => field.type === "hidden")) return;

  if (first.name === "first_name") return typeInto(page, first.name, account.firstName);

  if (first.name === "last_name") return typeInto(page, first.name, account.lastName);

  if (first.name === "email") return typeInto(page, first.name, account.email);

  if (first.name === "resume") {
    return input.attach ? attachFile(page, first.name, files.resume) : undefined;
  }

  if (first.name === "cover_letter") return fillCoverLetter(page, question, input);

  if (first.type === "file") return;

  return fillAnswer(page, question, value, input);
};

const untouched = async (page: Page, question: FormQuestion) => {
  const [first] = question.fields;

  if (first === undefined || filledByDriver(question)) return true;

  if (first.name.startsWith(demographicPrefix)) {
    const id = controlOf(first.name);

    return (await shownIn(page, id)) === null && (await chipsIn(page, id)).length === 0;
  }

  if (first.type === "multi_select") return (await tickedIn(page, first.name)).length === 0;

  if (first.name === "location") return (await shownIn(page, locationControl)) === null;

  if (first.type === "single_select") return (await shownIn(page, first.name)) === null;

  return ((await valueOf(page, byId(first.name))) ?? "") === "";
};

export const fillGreenhouse = async (page: Page, input: FillInput) => {
  const values = new Map(input.confirmed.map((answer) => [answer.questionId, answer.value]));

  await page.evaluate(guardExpression, z.boolean());

  for (const question of input.questions) {
    const failure = await fillQuestion(page, question, values.get(question.id) ?? null, input);

    if (failure !== undefined) return failure;
  }

  for (const question of input.questions) {
    if ((values.get(question.id) ?? null) !== null) continue;

    if (!(await untouched(page, question))) return fail("fill_failed", question.id);
  }
};

export const submitGreenhouse = async (page: Page) => {
  const before = await page.evaluate(outcomeExpression, outcomePage);

  if (challengeVisible(before)) return "challenge";

  if (errorsVisible(before)) return "errors";

  if (!(await page.evaluate(liftExpression, z.boolean()))) return "unguarded";

  await page.click(submitButton);

  return "clicked";
};

const errorLimit = 5;

export const visibleErrors = async (page: Page) => {
  const { errors } = await page.evaluate(outcomeExpression, outcomePage);
  const texts = errors.flatMap((error) => (error.visible && error.text !== "" ? [error.text] : []));

  return [...new Set(texts)].slice(0, errorLimit);
};

export const awaitOutcome = async (page: Page, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const signalled = await page.waitFor(confirmationSignal, Math.max(1, deadline - Date.now()));
    const outcome = classifyOutcome(await page.evaluate(outcomeExpression, outcomePage));

    if (outcome === "confirmed" || !signalled || Date.now() >= deadline) return outcome;

    await sleep(Math.min(outcomePollMs, deadline - Date.now()));
  }
};
