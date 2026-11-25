import { z } from "zod";
import type { FormField, FormQuestion } from "@offboard/db/schema";
import { htmlToText } from "../../shared/html-text.js";
import { discardBody, readCapped } from "../../shared/response-body.js";
import { detectKind, isSensitive } from "./questions.js";

export type FormResult = { questions: FormQuestion[] } | { error: "not_found" | "unreadable" };

const maxBytes = 2_000_000;
const timeoutMs = 10_000;

const fieldTypes = new Map<string, FormField["type"]>([
  ["input_text", "text"],
  ["textarea", "textarea"],
  ["input_file", "file"],
  ["input_hidden", "hidden"],
  ["multi_value_single_select", "single_select"],
  ["multi_value_multi_select", "multi_select"],
]);

const scalar = z.union([z.string(), z.number()]);

const rawField = z.object({
  name: z.string(),
  type: z.string(),
  values: z.array(z.object({ label: z.string(), value: scalar })).nullish(),
});

const rawQuestion = z.object({
  label: z.string(),
  required: z.boolean(),
  fields: z.array(rawField),
});

const rawDemographic = z.object({
  id: scalar,
  label: z.string(),
  required: z.boolean(),
  type: z.string(),
  answer_options: z.array(z.object({ id: scalar, label: z.string() })).nullish(),
});

const job = z.object({
  questions: z.array(rawQuestion),
  location_questions: z.array(rawQuestion).nullish(),
  compliance: z.array(z.object({ questions: z.array(rawQuestion).nullish() })).nullish(),
  demographic_questions: z.object({ questions: z.array(rawDemographic).nullish() }).nullish(),
});

type RawField = { name: string; type: string; options: { label: string; value: string }[] };

const build = (
  id: string,
  rawLabel: string,
  required: boolean,
  section: FormQuestion["section"],
  raw: RawField[],
) => {
  const fields = raw.flatMap(({ name, type, options }) => {
    const mapped = fieldTypes.get(type);

    return mapped === undefined ? [] : [{ name, type: mapped, options }];
  });

  const [first] = fields;

  if (first === undefined && !required) return [];

  const label = htmlToText(rawLabel);

  return [
    {
      id,
      label,
      required,
      section,
      fields,
      kind: first === undefined ? "document" : detectKind(label, first),
      sensitive: isSensitive(label, section),
    } satisfies FormQuestion,
  ];
};

const fromQuestions = (
  questions: z.infer<typeof rawQuestion>[] | null | undefined,
  section: FormQuestion["section"],
) =>
  (questions ?? []).flatMap((item) => {
    const first = item.fields[0];

    if (first === undefined) return [];

    const raw = item.fields.map(({ name, type, values }) => ({
      name,
      type,
      options: (values ?? []).map((option) => ({
        label: option.label,
        value: String(option.value),
      })),
    }));

    return build(first.name, item.label, item.required, section, raw);
  });

const fromDemographic = (questions: z.infer<typeof rawDemographic>[] | null | undefined) =>
  (questions ?? []).flatMap((item) => {
    const id = `demographic:${item.id}`;

    const options = (item.answer_options ?? []).map((option) => ({
      label: option.label,
      value: String(option.id),
    }));

    return build(id, item.label, item.required, "demographic", [
      { name: id, type: item.type, options },
    ]);
  });

const download = async (url: string, fetchImpl: typeof fetch) => {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
      headers: { accept: "application/json" },
    });

    if (response.status === 404) {
      await discardBody(response);

      return { error: "not_found" } satisfies FormResult;
    }

    if (!response.ok || Number(response.headers.get("content-length")) > maxBytes) {
      await discardBody(response);

      return { error: "unreadable" } satisfies FormResult;
    }

    const text = response.body === null ? null : await readCapped(response.body, maxBytes);

    return text === null ? ({ error: "unreadable" } satisfies FormResult) : { text };
  } catch {
    return { error: "unreadable" } satisfies FormResult;
  }
};

const parse = (text: string) => {
  try {
    return job.safeParse(JSON.parse(text));
  } catch {
    return null;
  }
};

export const readGreenhouseForm = async (fetchImpl: typeof fetch, board: string, jobId: string) => {
  const downloaded = await download(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(jobId)}?questions=true`,
    fetchImpl,
  );

  if (downloaded.text === undefined) return { error: downloaded.error } satisfies FormResult;

  const parsed = parse(downloaded.text);

  if (parsed === null || !parsed.success) return { error: "unreadable" } satisfies FormResult;

  const { data } = parsed;

  return {
    questions: [
      ...fromQuestions(data.questions, "questions"),
      ...fromQuestions(data.location_questions, "location"),
      ...(data.compliance ?? []).flatMap((entry) => fromQuestions(entry.questions, "compliance")),
      ...fromDemographic(data.demographic_questions?.questions),
    ],
  };
};
