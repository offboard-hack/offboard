import { z } from "zod";
import type { GenerateStructured } from "../../shared/ai.js";
import type { ProfileText } from "../../shared/embed.js";

export type RankedCandidate = {
  id: string;
  name: string;
  content: ProfileText;
  distance: number;
};

const relevanceSchema = z.object({
  scores: z.array(z.object({ id: z.string(), score: z.number().min(0).max(100) })),
});

function candidateSummary(candidate: RankedCandidate) {
  const parts = [candidate.content.headline.text, candidate.content.summary.text];

  for (const exp of candidate.content.experiences.slice(0, 3)) {
    const bullets = exp.bullets.map((b) => b.text).join("; ");

    parts.push(`${exp.role} @ ${exp.company}${bullets ? ` — ${bullets}` : ""}`);
  }

  if (candidate.content.skills.length > 0) {
    parts.push(`Skills: ${candidate.content.skills.map((s) => s.name).join(", ")}`);
  }

  return parts.filter(Boolean).join("\n");
}

export function createReranker(generate: GenerateStructured) {
  return async function rerank(query: string, candidates: RankedCandidate[]) {
    if (candidates.length === 0) return [];

    const descriptions = candidates
      .map((c) => `[${c.id}]\n${candidateSummary(c)}`)
      .join("\n\n---\n\n");

    const result = await generate({
      schema: relevanceSchema,
      system: [
        "You are a recruiter evaluating how well each candidate profile matches a search query.",
        "Score each candidate from 0 to 100 based on relevance to the query.",
        "100 = perfect match, 0 = completely irrelevant.",
        "Consider job titles, skills, experience descriptions, and semantic meaning.",
        "Return scores for every candidate ID provided.",
      ].join(" "),
      prompt: `Query: "${query}"\n\nCandidates:\n\n${descriptions}`,
      timeoutMs: 15_000,
    });

    const scoreMap = new Map(result.scores.map((s) => [s.id, s.score]));

    return candidates
      .map((c) => ({ ...c, match: scoreMap.get(c.id) ?? 0 }))
      .sort((a, b) => b.match - a.match);
  };
}
