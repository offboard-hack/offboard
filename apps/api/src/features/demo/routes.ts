import { Elysia, t } from "elysia";
import type { Embed, ProfileText } from "../../shared/embed.js";
import { logFailure } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import { profileCard, toProfileCard } from "../../shared/profile-card.js";
import type { SearchQuota } from "../../shared/search-quota.js";
import { demoProfiles } from "./profiles.js";
import type { DemoRepository } from "./repository.js";

const resultLimit = 6;
const limits = { visitor: 30, total: 2_000 };

export type DemoProfile = {
  slug: string;
  name: string;
  content: ProfileText & { contact: { city: string } };
};

export function demoRoutes(
  repo: DemoRepository,
  quota: SearchQuota,
  embed: Embed | undefined,
  profiles: readonly DemoProfile[] = demoProfiles,
) {
  const bySlug = new Map(profiles.map((profile) => [profile.slug, profile]));

  return new Elysia().get(
    "/demo/search",
    async ({ query, request, status }) => {
      if (!embed) return status(503, { error: "Search not configured" });

      if (!(await quota.takeForVisitor("demo", request, limits))) {
        return status(429, { error: "Too many searches" });
      }

      const vectors = await embed([query.q.trim()]).catch(
        logFailure("demo search embedding failed"),
      );

      if (!vectors) return status(502, { error: "Search unavailable" });

      const nearest = await repo.nearest(vectors[0], resultLimit);

      return nearest.flatMap(({ slug, distance }) => {
        const profile = bySlug.get(slug);

        return profile ? [toProfileCard(slug, profile.name, profile.content, distance)] : [];
      });
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
