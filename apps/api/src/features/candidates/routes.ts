import { Elysia, t } from "elysia";
import type { Embed } from "../../shared/embed.js";
import { logFailure } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import { profileCard, toProfileCard } from "../../shared/profile-card.js";
import type { SearchQuota } from "../../shared/search-quota.js";
import type { CandidatesRepository } from "./repository.js";

const resultLimit = 12;
const limits = { visitor: 30, total: 2_000 };

export function candidatesRoutes(
  repo: CandidatesRepository,
  quota: SearchQuota,
  embed: Embed | undefined,
) {
  return new Elysia().get(
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
  );
}
