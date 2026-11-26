import type {
  AttemptEvidence,
  ConfirmedAnswer,
  FormField,
  FormQuestion,
  ResumeContent,
} from "@offboard/db/schema";
import { aiApplyAccess } from "../../shared/ai-apply-access.js";
import { logFailure, logFailureCode } from "../../shared/error-summary.js";
import type { ObjectStorage } from "../../shared/object-storage.js";
import { renderLetterPdf } from "../../shared/resume-pdf.js";
import { shareFilteredResume } from "../../shared/shared-resume.js";
import type { createBrowserbase } from "./browser/browserbase.js";
import type { Page } from "./browser/cdp.js";
import {
  awaitOutcome,
  checkForm,
  fillGreenhouse,
  readLiveForm,
  submitGreenhouse,
} from "./browser/greenhouse-form.js";
import { splitName } from "./draft.js";
import { stuckMs, type AiApplyRepository } from "./repository.js";

export type RunnerDeps = {
  repo: AiApplyRepository;
  allowlist: string[];
  browserbase: ReturnType<typeof createBrowserbase> | undefined;
  openPage: (connectUrl: string) => Promise<Page>;
  storage: ObjectStorage | undefined;
  renderResume: (name: string, content: ResumeContent) => Promise<Uint8Array>;
  budgetMs: number;
  outcomeMs: number;
};

type Runnable = NonNullable<Awaited<ReturnType<AiApplyRepository["runnable"]>>>;

type Ending = {
  state: "rehearsed" | "assisted" | "needs_check" | "cancelled";
  reason: string | null;
};

type Outcome = { state: "submitted"; reason: null } | Ending;

type Account = { firstName: string; lastName: string; email: string };

type Run = {
  deps: RunnerDeps;
  browserbase: NonNullable<RunnerDeps["browserbase"]>;
  run: Runnable;
  resume: ResumeContent;
  confirmed: ConfirmedAnswer[];
  attemptId: string;
  now: () => Date;
};

type Progress = {
  submitting: boolean;
  sessionId: string | undefined;
  page: Page | undefined;
  evidence: AttemptEvidence;
  screenshotKey: string | null;
};

const uploadDir = "/tmp/.uploads/";
const resumeFile = "curriculo.pdf";
const letterFile = "carta-de-apresentacao.pdf";
const submitMarginMs = 15_000;

const skipped = { skipped: true } as const;

const withinBudget = (deadline: number, neededMs = 0) => {
  if (Date.now() + neededMs >= deadline) throw new Error("Run budget exceeded");
};

const changedAfter = (at: Date | null, confirmedAt: Date) => at !== null && at > confirmedAt;

const assisted = (reason: string) => ({ state: "assisted", reason }) satisfies Ending;
const cancelled = (reason: string) => ({ state: "cancelled", reason }) satisfies Ending;
const needsCheck = { state: "needs_check", reason: null } satisfies Ending;

const afterClick = {
  confirmed: { state: "submitted", reason: null },
  blocked: assisted("blocked"),
  invalid: assisted("form_changed"),
  timeout: needsCheck,
} satisfies Record<Awaited<ReturnType<typeof awaitOutcome>>, Outcome>;

const firstField = (questions: FormQuestion[], name: string) =>
  questions.find((question) => question.fields[0]?.name === name);

function refusal(run: Runnable, allowlist: string[]) {
  const { profile } = run;

  if (profile.consentAt === null) return cancelled("consent_withdrawn");

  const access = aiApplyAccess(
    { personalEmail: profile.email, aiApplyConsentAt: profile.consentAt.toISOString() },
    allowlist,
  );

  if (access !== "allowed") return cancelled("not_allowed");

  if (run.applied) return cancelled("applied_manually");

  return run.job.closedAt === null ? undefined : assisted("job_closed");
}

function letterPlan(questions: FormQuestion[], coverLetter: string | null) {
  const letter = firstField(questions, "cover_letter");

  if (letter === undefined || coverLetter === null) return { text: null, file: null };

  return letter.fields.some((field) => field.name === "cover_letter_text")
    ? { text: coverLetter, file: null }
    : { text: null, file: coverLetter };
}

const optionLabels = (field: FormField, value: string | string[]) =>
  field.options.flatMap((option) => ([value].flat().includes(option.value) ? [option.label] : []));

function sentValue(field: FormField, value: string | string[]) {
  if (field.type === "multi_select") return optionLabels(field, value);

  return field.type === "single_select" ? optionLabels(field, value).join("") : value;
}

function sentFields(
  questions: FormQuestion[],
  confirmed: ConfirmedAnswer[],
  account: Account,
  letterText: string | null,
) {
  const values = new Map(confirmed.map((answer) => [answer.questionId, answer.value]));

  const fixed = new Map([
    ["first_name", account.firstName],
    ["last_name", account.lastName],
    ["email", account.email],
    ["cover_letter", letterText],
  ]);

  return questions.flatMap((question) =>
    question.fields.slice(0, 1).flatMap((field) => {
      const value = fixed.has(field.name)
        ? (fixed.get(field.name) ?? null)
        : (values.get(question.id) ?? null);

      return value === null ? [] : [{ question: question.label, value: sentValue(field, value) }];
    }),
  );
}

async function capture(deps: RunnerDeps, page: Page, key: string) {
  if (deps.storage === undefined) return null;

  const bytes = await page.screenshot({ fullPage: true });

  await deps.storage.put(key, bytes, "image/png");

  return key;
}

async function rendered(ready: Run, letter: string | null) {
  const { deps, run } = ready;
  const { questions } = run.attempt.form;
  const files: { name: string; bytes: Uint8Array }[] = [];

  if (firstField(questions, "resume") !== undefined) {
    const fields = await deps.repo.profileFields(run.attempt.profileId);
    const content = shareFilteredResume(ready.resume, fields);

    files.push({ name: resumeFile, bytes: await deps.renderResume(run.profile.name, content) });
  }

  if (letter !== null) {
    files.push({ name: letterFile, bytes: await renderLetterPdf(run.profile.name, letter) });
  }

  return files;
}

async function operate(ready: Run, progress: Progress, deadline: number) {
  const { deps, browserbase, run, confirmed, attemptId, now } = ready;
  const { questions } = run.attempt.form;
  const { rehearsal } = run.attempt;
  const letter = letterPlan(questions, run.coverLetter);
  const files = rehearsal ? [] : await rendered(ready, letter.file);
  const session = await browserbase.createSession();

  progress.sessionId = session.id;

  const uploaded: string[] = [];

  withinBudget(deadline);

  for (const file of files) {
    try {
      await browserbase.upload(session.id, { ...file, type: "application/pdf" });
    } catch (cause) {
      logFailure("AI application upload failed")(cause);

      return assisted("upload_failed");
    }

    uploaded.push(file.name);
  }

  const page = await deps.openPage(session.connectUrl);

  progress.page = page;

  withinBudget(deadline);
  await page.navigate(run.job.url);

  const live = await readLiveForm(page);

  if (live.closed) return assisted("job_closed");

  if (live.loginRequired) return assisted("login_required");

  if (live.blocked) return assisted("blocked");

  if (checkForm(live, questions, confirmed) !== "ok") return assisted("form_changed");

  const names = splitName(run.profile.name);
  const account = { firstName: names.first, lastName: names.last, email: run.profile.email };

  progress.evidence.fields = sentFields(questions, confirmed, account, letter.text);
  progress.evidence.files = uploaded;

  withinBudget(deadline);

  const failure = await fillGreenhouse(page, {
    questions,
    confirmed,
    account,
    files: {
      resume: `${uploadDir}${resumeFile}`,
      coverLetter: letter.file === null ? null : `${uploadDir}${letterFile}`,
      coverLetterText: letter.text,
    },
    phoneCountry: "BR",
    attach: !rehearsal,
  });

  if (failure !== undefined) return assisted(failure.failed);

  const key = `ai-applications/${run.attempt.profileId}/${attemptId}.png`;

  if (rehearsal) {
    progress.screenshotKey = await capture(deps, page, key);

    return { state: "rehearsed", reason: null } satisfies Ending;
  }

  withinBudget(deadline, deps.outcomeMs + submitMarginMs);

  if (!(await deps.repo.markSubmitting(attemptId, now()))) {
    const fresh = await deps.repo.runnable(attemptId);

    return (fresh === undefined ? undefined : refusal(fresh, deps.allowlist)) ?? assisted("error");
  }

  progress.submitting = true;

  if ((await submitGreenhouse(page)) === "not_clicked") return assisted("form_changed");

  const seen = await awaitOutcome(page, deps.outcomeMs);

  progress.screenshotKey = await capture(deps, page, key).catch((cause) => {
    logFailure("AI application screenshot failed")(cause);

    return null;
  });

  return afterClick[seen];
}

async function record(ready: Run, progress: Progress, outcome: Outcome) {
  const { deps, attemptId, now } = ready;
  const { evidence, screenshotKey } = progress;

  if (outcome.state === "submitted") {
    const result = await deps.repo.submittedWithApplication(
      attemptId,
      { evidence, screenshotKey },
      now(),
    );

    if (result !== "submitted") logFailure("AI application result lost")(new Error(result));

    return;
  }

  const from = progress.submitting ? "submitting" : "running";

  await deps.repo.finish(attemptId, [from], { ...outcome, evidence, screenshotKey }, now());
}

async function drive(ready: Run, deadline: number) {
  const progress: Progress = {
    submitting: false,
    sessionId: undefined,
    page: undefined,
    evidence: { fields: [], files: [], finalUrl: null },
    screenshotKey: null,
  };

  let outcome: Outcome;

  try {
    outcome = await operate(ready, progress, deadline);
  } catch (cause) {
    logFailure("AI application run failed")(cause);
    outcome = progress.submitting ? needsCheck : assisted("error");
  }

  const { page, sessionId } = progress;

  if (page !== undefined) {
    progress.evidence.finalUrl = await page.url().catch(() => null);

    try {
      page.close();
    } catch (cause) {
      logFailure("AI application page close failed")(cause);
    }
  }

  await record(ready, progress, outcome).catch(logFailureCode("AI application result not saved"));

  if (sessionId !== undefined) {
    await ready.browserbase.release(sessionId).catch(logFailure("Browserbase release failed"));
  }
}

export async function runAiApplication(deps: RunnerDeps, attemptId: string, now: () => Date) {
  const run = await deps.repo.runnable(attemptId);

  if (run === undefined) return skipped;

  const { state, confirmed } = run.attempt;

  if (state === "submitting") {
    const { updatedAt } = run.attempt;

    if (updatedAt === null || updatedAt.getTime() < now().getTime() - stuckMs) {
      await deps.repo.finish(attemptId, ["submitting"], needsCheck, now());
    }

    return skipped;
  }

  if (state !== "queued" && state !== "running") return skipped;

  const refused = refusal(run, deps.allowlist);

  if (refused !== undefined) {
    await deps.repo.finish(attemptId, ["queued", "running"], refused, now());

    return skipped;
  }

  const { browserbase } = deps;
  const { resume } = run;
  const { confirmedAt } = run.attempt;

  if (browserbase === undefined || resume === null || confirmed === null || confirmedAt === null) {
    logFailure("AI application cannot run")(new Error("Browserbase or the résumé is missing"));
    await deps.repo.finish(attemptId, ["queued", "running"], assisted("error"), now());

    return skipped;
  }

  if (
    changedAfter(run.resumeUpdatedAt, confirmedAt) ||
    changedAfter(run.letterUpdatedAt, confirmedAt)
  ) {
    await deps.repo.finish(attemptId, ["queued", "running"], assisted("files_changed"), now());

    return skipped;
  }

  if (!(await deps.repo.claimForRun(attemptId, now()))) return skipped;

  const deadline = Date.now() + deps.budgetMs;

  await drive({ deps, browserbase, run, resume, confirmed, attemptId, now }, deadline);
}
