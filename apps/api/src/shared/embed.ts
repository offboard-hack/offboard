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

const vectors = z.object({ data: z.array(z.array(z.number()).length(dimensions)) });

export function workersAiEmbed(ai: WorkersAi) {
  return async (texts: string[]) => {
    const { data } = vectors.parse(await ai.run("@cf/baai/bge-m3", { text: texts }));

    if (data.length !== texts.length) throw new Error("Embedding count mismatch");

    return data;
  };
}
