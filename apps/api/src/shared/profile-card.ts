import { t } from "elysia";
import type { ProfileText } from "./embed.js";

const skillLimit = 8;

export const profileCard = t.Object({
  id: t.String(),
  name: t.String(),
  headline: t.String(),
  summary: t.String(),
  city: t.Union([t.String(), t.Null()]),
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

export function toProfileCard(id: string, name: string, content: ProfileText, distance: number) {
  return {
    id,
    name,
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
