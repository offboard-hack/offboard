import type { ResumeContent } from "@offboard/db/schema";
import { z } from "zod";

export type { ResumeContent };

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const textLimit = 2_000;

const sanitize = (value: string) => value.replaceAll("\u0000", "").replace(loneSurrogate, "\uFFFD");

const storable = () => z.string().overwrite(sanitize).trim();

const text = storable().max(textLimit);

export const storableText = (value: string) =>
  sanitize(value)
    .trim()
    .slice(0, textLimit)
    .replace(/[\uD800-\uDBFF]$/, "")
    .trim();

const nodeId = storable().min(1).max(64);

function contentSchema<Id extends z.ZodType<string | undefined>>(id: Id) {
  return z.object({
    headline: z.object({ id, text }),
    summary: z.object({ id, text }),
    experiences: z
      .array(
        z.object({
          id,
          company: text,
          role: text,
          start: text,
          end: text.nullable(),
          bullets: z.array(z.object({ id, text })).max(20),
        }),
      )
      .max(50),
    education: z
      .array(
        z.object({
          id,
          institution: text,
          degree: text,
          start: text.nullable(),
          end: text.nullable(),
        }),
      )
      .max(50),
    skills: z.array(z.object({ id, name: text })).max(50),
    languages: z.array(z.object({ id, name: text, level: text.nullable() })).max(50),
    contact: z.object({
      email: text.nullable(),
      phone: text.nullable(),
      city: text.nullable(),
      links: z.array(text).max(50),
    }),
  });
}

export const resumeContentSchema = contentSchema(nodeId) satisfies z.ZodType<ResumeContent>;

export const resumeContentInputSchema = contentSchema(nodeId.optional());

export type ResumeContentInput = z.infer<typeof resumeContentInputSchema>;

export function withNodeIds(
  input: ResumeContentInput,
  newId: () => string = () => crypto.randomUUID(),
) {
  const ids: string[] = [];

  const node = <T extends { id?: string }>(item: T) => {
    const id = item.id ?? newId();

    ids.push(id);

    return { ...item, id };
  };

  const content: ResumeContent = {
    headline: node(input.headline),
    summary: node(input.summary),
    experiences: input.experiences.map((experience) => ({
      ...node(experience),
      bullets: experience.bullets.map(node),
    })),
    education: input.education.map(node),
    skills: input.skills.map(node),
    languages: input.languages.map(node),
    contact: input.contact,
  };

  return new Set(ids).size === ids.length ? content : ("duplicate_ids" as const);
}
