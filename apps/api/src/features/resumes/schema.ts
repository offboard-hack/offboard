import { t, type TSchema } from "elysia";

const nullable = t.Union([t.String(), t.Null()]);

function contentObject<Id extends TSchema>(id: Id) {
  const node = t.Object({ id, text: t.String() });

  return t.Object({
    headline: node,
    summary: node,
    experiences: t.Array(
      t.Object({
        id,
        company: t.String(),
        role: t.String(),
        start: t.String(),
        end: nullable,
        bullets: t.Array(node),
      }),
    ),
    education: t.Array(
      t.Object({
        id,
        institution: t.String(),
        degree: t.String(),
        start: nullable,
        end: nullable,
      }),
    ),
    skills: t.Array(t.Object({ id, name: t.String() })),
    languages: t.Array(t.Object({ id, name: t.String(), level: nullable })),
    contact: t.Object({
      email: nullable,
      phone: nullable,
      city: nullable,
      links: t.Array(t.String()),
    }),
  });
}

export const resumeContentBody = contentObject(t.Optional(t.String()));

const resumeContent = contentObject(t.String());

export const resumeResponse = t.Object({
  id: t.String(),
  kind: t.Literal("base"),
  content: resumeContent,
  score: t.Union([t.Number(), t.Null()]),
  scoreBreakdown: t.Union([
    t.Record(t.String(), t.Object({ points: t.Number(), max: t.Number(), reason: t.String() })),
    t.Null(),
  ]),
  scoredAt: nullable,
  updatedAt: t.String(),
});

export const suggestionResponse = t.Object({
  id: t.String(),
  targetNodeId: t.String(),
  originalText: t.String(),
  suggestedText: t.String(),
  rationale: t.String(),
  criterion: nullable,
  estimatedGain: t.Number(),
  extraGainWithFacts: t.Number(),
});

export const versionResponse = t.Object({
  id: t.String(),
  job: t.Object({ id: t.String(), title: t.String(), company: t.String() }),
  status: t.Union([t.Literal("draft"), t.Literal("ready")]),
  matchScore: t.Union([t.Number(), t.Null()]),
  content: resumeContent,
  application: t.Union([
    t.Object({
      id: t.String(),
      status: t.Union([
        t.Literal("sent"),
        t.Literal("in_review"),
        t.Literal("interview"),
        t.Literal("offer"),
        t.Literal("closed"),
      ]),
      appliedAt: t.String(),
    }),
    t.Null(),
  ]),
  updatedAt: t.String(),
});

export const versionDiffResponse = t.Object({
  version: versionResponse,
  diff: t.Array(
    t.Object({
      nodeId: t.String(),
      kind: t.Union([t.Literal("headline"), t.Literal("summary"), t.Literal("bullet")]),
      before: t.String(),
      after: t.String(),
    }),
  ),
});
