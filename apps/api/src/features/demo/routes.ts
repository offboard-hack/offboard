import { Elysia, t } from "elysia";
import { textHash, type Embed, type ProfileText } from "../../shared/embed.js";
import { logFailure } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import { demoProfiles } from "./profiles.js";
import type { DemoRepository } from "./repository.js";

const resultLimit = 6;
const perVisitor = 30;
const perDay = 2_000;
const skillLimit = 8;

export type DemoProfile = {
  slug: string;
  name: string;
  content: ProfileText & { contact: { city: string } };
};

const card = t.Object({
  slug: t.String(),
  name: t.String(),
  headline: t.String(),
  summary: t.String(),
  city: t.String(),
  match: t.Number(),
  experiences: t.Array(
    t.Object({
      role: t.String(),
      company: t.String(),
      start: t.String(),
      end: t.Union([t.String(), t.Null()]),
    }),
  ),
  skills: t.Array(t.String()),
  languages: t.Array(t.Object({ name: t.String(), level: t.Union([t.String(), t.Null()]) })),
});

function toCard(profile: DemoProfile, distance: number) {
  const { content } = profile;

  return {
    slug: profile.slug,
    name: profile.name,
    headline: content.headline.text,
    summary: content.summary.text,
    city: content.contact.city,
    match: Math.max(0, Math.round((1 - distance) * 100)),
    experiences: content.experiences
      .slice(0, 2)
      .map(({ role, company, start, end }) => ({ role, company, start, end })),
    skills: content.skills.slice(0, skillLimit).map((skill) => skill.name),
    languages: content.languages.map(({ name, level }) => ({ name, level })),
  };
}

export function demoRoutes(
  repo: DemoRepository,
  embed: Embed | undefined,
  profiles: readonly DemoProfile[] = demoProfiles,
) {
  const bySlug = new Map(profiles.map((profile) => [profile.slug, profile]));

  return new Elysia().get(
    "/demo/search",
    async ({ query, request, status }) => {
      if (!embed) return status(503, { error: "Search not configured" });

      const visitor = await textHash(request.headers.get("cf-connecting-ip") ?? "unknown");
      const day = new Date().toISOString().slice(0, 10);

      const allowed = await repo.takeSearch(
        [
          { bucket: `ip:${visitor.slice(0, 32)}`, limit: perVisitor },
          { bucket: "all", limit: perDay },
        ],
        day,
      );

      if (!allowed) return status(429, { error: "Too many searches" });

      const vectors = await embed([query.q.trim()]).catch(
        logFailure("demo search embedding failed"),
      );

      if (!vectors) return status(502, { error: "Search unavailable" });

      const nearest = await repo.nearest(vectors[0], resultLimit);

      return nearest.flatMap(({ slug, distance }) => {
        const profile = bySlug.get(slug);

        return profile ? [toCard(profile, distance)] : [];
      });
    },
    {
      query: t.Object({ q: t.String({ minLength: 2, maxLength: 200 }) }),
      response: {
        200: t.Array(card),
        429: errorResponse,
        502: errorResponse,
        503: errorResponse,
      },
    },
  );
}
