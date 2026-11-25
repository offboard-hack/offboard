import type { ResumeContent } from "@offboard/db/schema";

export type PublicResume = {
  name: string;
  headline: string;
  summary: string;
  experiences: {
    company: string;
    role: string;
    start: string;
    end: string | null;
    bullets: string[];
  }[];
  education: { institution: string; degree: string; start: string | null; end: string | null }[];
  skills: string[];
  languages: { name: string; level: string | null }[];
  contact: { email: string | null; links: string[] };
};

export function toPublicResume(name: string, content: ResumeContent) {
  return {
    name,
    headline: content.headline.text,
    summary: content.summary.text,
    experiences: content.experiences.map(({ company, role, start, end, bullets }) => ({
      company,
      role,
      start,
      end,
      bullets: bullets.map((bullet) => bullet.text),
    })),
    education: content.education.map(({ institution, degree, start, end }) => ({
      institution,
      degree,
      start,
      end,
    })),
    skills: content.skills.map((skill) => skill.name),
    languages: content.languages.map(({ name: language, level }) => ({ name: language, level })),
    contact: { email: content.contact.email, links: [...content.contact.links] },
  } satisfies PublicResume;
}
