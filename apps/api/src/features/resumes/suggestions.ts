import type { Database } from "@offboard/db/client";
import { resumes, resumeSuggestions } from "@offboard/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { resumeContentSchema, type ResumeContent } from "./content.js";
import { baseOf, resumeColumns, toResumeView } from "./repository.js";
import { textNodes, type ScoredSuggestion } from "./score.js";

export type SuggestionView = {
  id: string;
  targetNodeId: string;
  originalText: string;
  suggestedText: string;
  rationale: string;
  estimatedGain: number;
};

type ScoreResult = { score: number; suggestions: ScoredSuggestion[] };

const viewColumns = {
  id: resumeSuggestions.id,
  targetNodeId: resumeSuggestions.targetNodeId,
  originalText: resumeSuggestions.originalText,
  suggestedText: resumeSuggestions.suggestedText,
  rationale: resumeSuggestions.rationale,
  estimatedGain: resumeSuggestions.estimatedGain,
};

function rewrite(content: ResumeContent, nodeId: string, text: string) {
  const swap = <T extends { id: string; text: string }>(node: T) =>
    node.id === nodeId ? { ...node, text } : node;

  return resumeContentSchema.parse({
    ...content,
    headline: swap(content.headline),
    summary: swap(content.summary),
    experiences: content.experiences.map((experience) => ({
      ...experience,
      bullets: experience.bullets.map(swap),
    })),
  });
}

export function createSuggestionsRepository(db: Database) {
  async function listOpen(profileId: string) {
    const rows = await db
      .select({ ...viewColumns, content: resumes.content })
      .from(resumeSuggestions)
      .innerJoin(resumes, eq(resumes.id, resumeSuggestions.resumeId))
      .where(and(baseOf(profileId), eq(resumeSuggestions.status, "open")))
      .orderBy(
        desc(resumeSuggestions.estimatedGain),
        asc(resumeSuggestions.createdAt),
        asc(resumeSuggestions.id),
      );

    return rows.flatMap(({ content, ...view }) =>
      textNodes(content).some(
        (node) => node.id === view.targetNodeId && node.text === view.originalText,
      )
        ? [view]
        : [],
    ) satisfies SuggestionView[];
  }

  async function saveScore(
    resumeId: string,
    expectedUpdatedAt: Date,
    result: ScoreResult,
    now: Date,
  ) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ updatedAt: resumeColumns.updatedAt })
        .from(resumes)
        .where(eq(resumes.id, resumeId))
        .for("update");

      if (row?.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return false;

      await tx
        .update(resumes)
        .set({ score: result.score, scoredAt: now })
        .where(eq(resumes.id, resumeId));

      await tx
        .delete(resumeSuggestions)
        .where(and(eq(resumeSuggestions.resumeId, resumeId), eq(resumeSuggestions.status, "open")));

      const dismissed = await tx
        .select({
          targetNodeId: resumeSuggestions.targetNodeId,
          originalText: resumeSuggestions.originalText,
        })
        .from(resumeSuggestions)
        .where(
          and(eq(resumeSuggestions.resumeId, resumeId), eq(resumeSuggestions.status, "dismissed")),
        );

      const fresh = result.suggestions.filter(
        (suggestion) =>
          !dismissed.some(
            (row) =>
              row.targetNodeId === suggestion.targetNodeId &&
              row.originalText === suggestion.originalText,
          ),
      );

      if (fresh.length > 0) {
        await tx.insert(resumeSuggestions).values(
          fresh.map((suggestion) => ({
            ...suggestion,
            resumeId,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      return true;
    });
  }

  async function apply(profileId: string, suggestionId: string, now: Date) {
    return db.transaction(async (tx) => {
      const [resume] = await tx
        .select({ id: resumes.id, content: resumes.content })
        .from(resumes)
        .where(baseOf(profileId))
        .for("update");

      if (!resume) return "not_found" as const;

      const [suggestion] = await tx
        .select({
          targetNodeId: resumeSuggestions.targetNodeId,
          originalText: resumeSuggestions.originalText,
          suggestedText: resumeSuggestions.suggestedText,
        })
        .from(resumeSuggestions)
        .where(
          and(
            eq(resumeSuggestions.id, suggestionId),
            eq(resumeSuggestions.resumeId, resume.id),
            eq(resumeSuggestions.status, "open"),
          ),
        )
        .for("update");

      if (!suggestion) return "not_found" as const;

      const node = textNodes(resume.content).find(
        (candidate) => candidate.id === suggestion.targetNodeId,
      );

      if (node?.text !== suggestion.originalText) return "stale" as const;

      await tx
        .update(resumeSuggestions)
        .set({ status: "applied", updatedAt: now })
        .where(eq(resumeSuggestions.id, suggestionId));

      const [row] = await tx
        .update(resumes)
        .set({
          content: rewrite(resume.content, suggestion.targetNodeId, suggestion.suggestedText),
          score: null,
          scoredAt: null,
          updatedAt: now,
        })
        .where(eq(resumes.id, resume.id))
        .returning(resumeColumns);

      return toResumeView(row);
    });
  }

  async function dismiss(profileId: string, suggestionId: string) {
    const dismissed = await db
      .update(resumeSuggestions)
      .set({ status: "dismissed", updatedAt: new Date() })
      .where(
        and(
          eq(resumeSuggestions.id, suggestionId),
          eq(resumeSuggestions.status, "open"),
          inArray(
            resumeSuggestions.resumeId,
            db.select({ id: resumes.id }).from(resumes).where(baseOf(profileId)),
          ),
        ),
      )
      .returning({ id: resumeSuggestions.id });

    return dismissed.length > 0;
  }

  return { listOpen, saveScore, apply, dismiss };
}

export type SuggestionsRepository = ReturnType<typeof createSuggestionsRepository>;
