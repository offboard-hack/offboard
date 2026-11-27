import type { ResumeContent } from "@offboard/db/schema";
import { z } from "zod";
import { htmlToText } from "./html-text.js";

export type Embed = (texts: string[]) => Promise<number[][]>;

export type EmbeddingJob = {
  title: string;
  company: string;
  workModel: string | null;
  city: string | null;
  state: string | null;
  description: string;
};

export type EmbeddingResponse = { data?: number[][] };

export type WorkersAi = {
  run: (model: "@cf/baai/bge-m3", input: { text: string[] }) => Promise<EmbeddingResponse>;
};

const dimensions = 1024;
const maxDescription = 2_000;

export function jobEmbeddingText(job: EmbeddingJob) {
  const location = [job.city, job.state].filter((part) => part !== null && part !== "").join(", ");

  return [
    job.title,
    job.company,
    location,
    job.workModel ?? "",
    htmlToText(job.description).slice(0, maxDescription),
  ]
    .filter((part) => part !== "")
    .join("\n");
}

export function resumeEmbeddingText(content: ResumeContent, titles: string[]) {
  return [
    ...titles,
    content.headline.text,
    ...content.experiences.map((experience) => experience.role),
    ...content.skills.map((skill) => skill.name),
    content.summary.text,
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function period(start: string | null, end: string | null) {
  return [start, end].filter((part) => part !== null && part !== "").join(" – ");
}

function line(parts: (string | null)[]) {
  return parts.filter((part) => part !== null && part !== "").join(" · ");
}

export type ProfileText = {
  headline: { text: string };
  summary: { text: string };
  experiences: readonly {
    role: string;
    company: string;
    start: string;
    end: string | null;
    bullets: readonly { text: string }[];
  }[];
  education: readonly {
    degree: string;
    institution: string;
    start: string | null;
    end: string | null;
  }[];
  skills: readonly { name: string }[];
  languages: readonly { name: string; level: string | null }[];
  contact: { city: string | null };
};

export function profileEmbeddingText(content: ProfileText) {
  return [
    content.headline.text,
    content.summary.text,
    ...content.experiences.flatMap((experience) => [
      line([
        experience.role,
        experience.company,
        period(experience.start, experience.end ?? "atual"),
      ]),
      ...experience.bullets.map((bullet) => bullet.text),
    ]),
    ...content.education.map((education) =>
      line([education.degree, education.institution, period(education.start, education.end)]),
    ),
    content.skills.map((skill) => skill.name).join(", "),
    content.languages
      .map((language) => (language.level ? `${language.name} (${language.level})` : language.name))
      .join(", "),
    content.contact.city ?? "",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

const vectors = z.object({ data: z.array(z.array(z.number()).length(dimensions)) });

export function workersAiEmbed(ai: WorkersAi) {
  return async (texts: string[]) => {
    const { data } = vectors.parse(await ai.run("@cf/baai/bge-m3", { text: texts }));

    if (data.length !== texts.length) throw new Error("Embedding count mismatch");

    return data;
  };
}

export async function textHash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
