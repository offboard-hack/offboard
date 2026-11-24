import type { ResumeContent } from "@offboard/db/schema";

const maxTerms = 40;

export function searchTerms(content: ResumeContent) {
  const sources = [
    content.headline.text,
    ...content.experiences.map((experience) => experience.role),
    ...content.skills.map((skill) => skill.name),
    content.summary.text,
  ];

  const terms = new Set<string>();

  for (const source of sources) {
    for (const token of source
      .normalize("NFC")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)) {
      if (token.length >= 3) terms.add(token);
    }
  }

  return [...terms].slice(0, maxTerms);
}

export const toTsQuery = (terms: string[]) => (terms.length > 0 ? terms.join(" | ") : null);
