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

export const resumeResponse = t.Object({
  id: t.String(),
  kind: t.Literal("base"),
  content: contentObject(t.String()),
  score: t.Union([t.Number(), t.Null()]),
  scoredAt: nullable,
  updatedAt: t.String(),
});

export const suggestionResponse = t.Object({
  id: t.String(),
  targetNodeId: t.String(),
  originalText: t.String(),
  suggestedText: t.String(),
  rationale: t.String(),
  estimatedGain: t.Number(),
});
