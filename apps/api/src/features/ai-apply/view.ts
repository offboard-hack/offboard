import type { DraftAnswer, FormQuestion } from "@offboard/db/schema";
import { aiApplicationStateEnum } from "@offboard/db/schema";
import { t } from "elysia";

type AttemptRow = {
  id: string;
  state: (typeof aiApplicationStateEnum.enumValues)[number];
  reason: string | null;
  form: { questions: FormQuestion[] };
  draft: DraftAnswer[];
  rehearsal: boolean;
  preparedAt: Date;
  confirmedAt: Date | null;
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

export const attemptResponse = t.Object({
  id: t.String(),
  job: t.Object({ id: t.String(), title: t.String(), company: t.String(), url: t.String() }),
  state: t.UnionEnum([...aiApplicationStateEnum.enumValues]),
  reason: t.Union([t.String(), t.Null()]),
  questions: t.Array(formQuestion),
  answers: t.Array(draftAnswer),
  rehearsal: t.Boolean(),
  preparedAt: t.String(),
  confirmedAt: t.Union([t.String(), t.Null()]),
});

export const toAttemptView = (row: AttemptRow, job: AttemptJob) => ({
  id: row.id,
  job: { id: job.id, title: job.title, company: job.company, url: job.url },
  state: row.state,
  reason: row.reason,
  questions: row.form.questions,
  answers: row.draft,
  rehearsal: row.rehearsal,
  preparedAt: row.preparedAt.toISOString(),
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
});
