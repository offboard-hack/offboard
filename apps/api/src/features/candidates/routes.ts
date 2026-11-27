import { Elysia, t } from "elysia";
import type { Embed } from "../../shared/embed.js";
import { logFailure } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import { profileCard, toProfileCard } from "../../shared/profile-card.js";
import type { SearchQuota } from "../../shared/search-quota.js";
import { contactEmail } from "./contact.js";
import type { RankedCandidate } from "./rerank.js";
import type { CandidatesRepository } from "./repository.js";

const resultLimit = 12;
const limits = { visitor: 30, total: 2_000 };
const contactLimits = { visitor: 5, total: 300 };
const contactsPerCandidate = 5;

type Message = { to: string; subject: string; text: string; html: string };

export type Rerank = (
  query: string,
  candidates: RankedCandidate[],
) => Promise<{ id: string; name: string; content: RankedCandidate["content"]; match: number }[]>;

export function candidatesRoutes(
  repo: CandidatesRepository,
  quota: SearchQuota,
  embed: Embed | undefined,
  mail: { send: (message: Message) => Promise<void>; origin: string },
  rerank?: Rerank,
) {
  return new Elysia()
    .get(
      "/candidates/search",
      async ({ query, request, status }) => {
        if (!embed) return status(503, { error: "Search not configured" });

        if (!(await quota.takeForVisitor("candidates", request, limits))) {
          return status(429, { error: "Too many searches" });
        }

        const vectors = await embed([query.q.trim()]).catch(
          logFailure("candidate search embedding failed"),
        );

        if (!vectors) return status(502, { error: "Search unavailable" });

        const nearest = await repo.nearest(vectors[0], resultLimit);

        if (rerank && nearest.length > 0) {
          const reranked = await rerank(query.q.trim(), nearest).catch(
            logFailure("candidate reranking failed"),
          );

          if (reranked) {
            return reranked.map((row) => ({
              id: row.id,
              name: row.name,
              headline: row.content.headline.text,
              summary: row.content.summary.text,
              city: row.content.contact.city,
              match: row.match,
              experiences: row.content.experiences
                .slice(0, 2)
                .map(({ role, company, start, end }) => ({ role, company, start, end })),
              skills: row.content.skills.slice(0, 8).map((skill) => skill.name),
              languages: row.content.languages.map(({ name, level }) => ({ name, level })),
            }));
          }
        }

        return nearest.map((row) => toProfileCard(row.id, row.name, row.content, row.distance));
      },
      {
        query: t.Object({ q: t.String({ minLength: 2, maxLength: 200 }) }),
        response: {
          200: t.Array(profileCard),
          429: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    )
    .post(
      "/candidates/:id/contact",
      async ({ params, body, request, status }) => {
        if (!(await quota.takeForVisitor("contact", request, contactLimits))) {
          return status(429, { error: "Too many messages" });
        }

        const candidate = await repo.contactTarget(params.id);

        if (!candidate) return status(404, { error: "Candidate not found" });

        const day = new Date().toISOString().slice(0, 10);

        if (
          !(await quota.take(
            [{ bucket: `contact:to:${params.id}`, limit: contactsPerCandidate }],
            day,
          ))
        ) {
          return status(429, { error: "Too many messages" });
        }

        const sent = await mail
          .send(contactEmail(candidate, { ...body, message: body.message.trim() }, mail.origin))
          .then(() => true)
          .catch(logFailure("candidate contact email failed"));

        if (!sent) return status(502, { error: "Could not send the message" });

        return new Response(null, { status: 204 });
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({
          name: t.String({ minLength: 2, maxLength: 120 }),
          email: t.String({ format: "email", maxLength: 255 }),
          company: t.Optional(t.String({ maxLength: 120 })),
          message: t.String({ minLength: 20, maxLength: 2_000 }),
        }),
        response: {
          204: t.Void(),
          404: errorResponse,
          429: errorResponse,
          502: errorResponse,
        },
      },
    );
}
