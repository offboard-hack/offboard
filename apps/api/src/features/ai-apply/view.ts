import type {
  AttemptEvidence,
  ConfirmedAnswer,
  DraftAnswer,
  FormQuestion,
} from "@offboard/db/schema";
import { aiApplicationStateEnum } from "@offboard/db/schema";
import { t } from "elysia";

type AttemptRow = {
  id: string;
  state: (typeof aiApplicationStateEnum.enumValues)[number];
  reason: string | null;
  form: { questions: FormQuestion[] };
  draft: DraftAnswer[];
  confirmed: ConfirmedAnswer[] | null;
  rehearsal: boolean;
  preparedAt: Date;
  confirmedAt: Date | null;
  evidence: AttemptEvidence | null;
  screenshotKey: string | null;
  liveUrl: string | null;
};

type AttemptJob = { id: string; title: string; company: string; url: string };

const answerValue = t.Union([t.String(), t.Array(t.String()), t.Null()]);

const formQuestion = t.Object({
  id: t.String(),
  label: t.String(),
  required: t.Boolean(),
  section: t.UnionEnum(["questions", "location", "compliance", "demographic"]),
  fields: t.Array(
    t.Object({
      name: t.String(),
      type: t.UnionEnum(["text", "textarea", "file", "hidden", "single_select", "multi_select"]),
      options: t.Array(t.Object({ label: t.String(), value: t.String() })),
    }),
  ),
  kind: t.UnionEnum([
    "first_name",
    "last_name",
    "email",
    "phone",
    "resume",
    "cover_letter",
    "linkedin",
    "website",
    "cpf",
    "birth_date",
    "cep",
    "address",
    "city",
    "document",
    "custom",
  ]),
  sensitive: t.Boolean(),
});

const draftAnswer = t.Object({
  questionId: t.String(),
  value: answerValue,
  source: t.Union([
    t.UnionEnum(["account", "profile", "library", "resume", "cover_letter"]),
    t.Null(),
  ]),
  inferred: t.Boolean(),
  status: t.UnionEnum(["filled", "blank", "not_shared", "sensitive"]),
});

const confirmedAnswer = t.Object({ questionId: t.String(), value: answerValue });

const evidenceResponse = t.Object({
  fields: t.Array(t.Object({ question: t.String(), value: answerValue })),
  files: t.Array(t.String()),
  finalUrl: t.Union([t.String(), t.Null()]),
  failedField: t.Union([t.String(), t.Null()]),
  formErrors: t.Array(t.String()),
});

export const attemptResponse = t.Object({
  id: t.String(),
  job: t.Object({ id: t.String(), title: t.String(), company: t.String(), url: t.String() }),
  state: t.UnionEnum([...aiApplicationStateEnum.enumValues]),
  reason: t.Union([t.String(), t.Null()]),
  questions: t.Array(formQuestion),
  answers: t.Array(draftAnswer),
  confirmed: t.Union([t.Array(confirmedAnswer), t.Null()]),
  rehearsal: t.Boolean(),
  preparedAt: t.String(),
  confirmedAt: t.Union([t.String(), t.Null()]),
  evidence: t.Union([evidenceResponse, t.Null()]),
  hasScreenshot: t.Boolean(),
  liveUrl: t.Union([t.String(), t.Null()]),
});

export const toAttemptView = (row: AttemptRow, job: AttemptJob) => ({
  id: row.id,
  job: { id: job.id, title: job.title, company: job.company, url: job.url },
  state: row.state,
  reason: row.reason,
  questions: row.form.questions,
  answers: row.draft,
  confirmed: row.confirmed,
  rehearsal: row.rehearsal,
  preparedAt: row.preparedAt.toISOString(),
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
  evidence:
    row.evidence === null
      ? null
      : {
          ...row.evidence,
          failedField: row.evidence.failedField ?? null,
          formErrors: row.evidence.formErrors ?? [],
        },
  hasScreenshot: row.screenshotKey !== null,
  liveUrl: row.state === "running" || row.state === "submitting" ? row.liveUrl : null,
});
