import type { ResumeScoreBreakdown } from "@offboard/db/schema";
import { z } from "zod";
import { bounded } from "../../shared/bounded.js";
import { storableClip } from "../../shared/storable-text.js";

export const resumeCriteria = {
  results: {
    max: 20,
    rubric:
      "quantified results and impact. Points = 20 × the share of experience bullets that state a concrete result or scale (a number, percentage, money, time saved, volume, team or user count), rounded. Plain duties count as zero.",
  },
  keywords: {
    max: 15,
    rubric:
      "skills and role keywords present and relevant. 0–4 when the skills and text barely name tools, methods or the role; 5–9 when some are named; 10–12 when the headline role, the skills list and the bullets name the tools and methods recruiters search for that role; 13–15 when they are also consistent across headline, summary, skills and bullets.",
  },
  clarity: {
    max: 15,
    rubric:
      'concise, clear bullets. Start at 15 and subtract 2 for every bullet that is vague ("responsável por", "ajudou em", "atuei com"), longer than about 35 words, or mixes several ideas. Minimum 0.',
  },
  structure: {
    max: 15,
    rubric:
      "required sections. Add 2 for a headline, 2 for a summary, 4 when every experience has company, role and start date, 2 for education, 2 for a skills list and 3 for contact (an email or a phone).",
  },
  actionVerbs: {
    max: 10,
    rubric:
      'bullets led by strong action verbs. Points = 10 × the share of experience bullets that start with a strong action verb (Liderou, Reduziu, Implementou, Criou), rounded. Bullets starting with a noun, "Responsável por" or "Participação em" count as zero.',
  },
  summary: {
    max: 10,
    rubric:
      "summary quality. 0 when missing; 1–4 when generic; 5–7 when it states seniority, area and main strengths; 8–10 when it also gives a concrete differentiator or result in two to four sentences.",
  },
  consistency: {
    max: 10,
    rubric:
      "consistency. Start at 10, subtract 2 for every duplicated or near-duplicated bullet and 1 for every inconsistency in tense, grammatical person, date format or punctuation. Minimum 0.",
  },
  length: {
    max: 5,
    rubric:
      "appropriate length and density. 5 when recent experiences have two to six bullets each and the whole fits one or two pages; 3 when slightly sparse or slightly long; 0–2 when most experiences have no bullets or the text is bloated.",
  },
};

export type Criterion = keyof typeof resumeCriteria;

export const criteria = [
  "results",
  "keywords",
  "clarity",
  "structure",
  "actionVerbs",
  "summary",
  "consistency",
  "length",
] as const satisfies readonly Criterion[];

const assessed = z.object({ points: z.number(), reason: z.string() });

export const criteriaSchema = z.object({
  results: assessed,
  keywords: assessed,
  clarity: assessed,
  structure: assessed,
  actionVerbs: assessed,
  summary: assessed,
  consistency: assessed,
  length: assessed,
});

export function breakdownOf(assessment: z.infer<typeof criteriaSchema>) {
  return Object.fromEntries(
    criteria.map((criterion) => {
      const { max } = resumeCriteria[criterion];

      return [
        criterion,
        {
          points: bounded(assessment[criterion].points, 0, max),
          max,
          reason: storableClip(assessment[criterion].reason, 300),
        },
      ];
    }),
  ) satisfies ResumeScoreBreakdown;
}

export function totalOf(breakdown: ResumeScoreBreakdown) {
  return bounded(
    Object.values(breakdown).reduce((sum, entry) => sum + entry.points, 0),
    0,
    100,
  );
}

export function headroom(breakdown: ResumeScoreBreakdown, criterion: string) {
  const entry = breakdown[criterion];

  return entry ? Math.max(0, entry.max - entry.points) : 0;
}

export function provisionalScore(
  current: { score: number | null; breakdown: ResumeScoreBreakdown | null },
  criterion: string | null,
  gain: number,
) {
  const entry = criterion === null ? undefined : current.breakdown?.[criterion];

  if (current.breakdown && criterion !== null && entry) {
    const breakdown = {
      ...current.breakdown,
      [criterion]: { ...entry, points: Math.min(entry.max, entry.points + gain) },
    };

    return { score: totalOf(breakdown), breakdown };
  }

  return {
    score: current.score === null ? null : bounded(current.score + gain, 0, 100),
    breakdown: current.breakdown,
  };
}
