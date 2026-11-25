import { Elysia, t } from "elysia";
import { errorResponse } from "../../shared/http.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import type { PreferencesRepository } from "./repository.js";
import { preferencesInputSchema } from "./schema.js";

const invalid = { error: "Invalid preferences" };

const mode = t.Union([t.Literal("automatic"), t.Literal("hybrid"), t.Literal("review")]);

const nullableString = t.Union([t.String(), t.Null()]);

const jobPreferences = t.Object({
  workModels: t.Array(t.Union([t.Literal("remote"), t.Literal("hybrid"), t.Literal("onsite")])),
  locations: t.Array(t.Object({ city: nullableString, state: t.String() })),
  relocate: t.Boolean(),
  salaryFloorCents: t.Union([t.Integer(), t.Null()]),
  seniorities: t.Array(
    t.Union([
      t.Literal("intern"),
      t.Literal("junior"),
      t.Literal("mid"),
      t.Literal("senior"),
      t.Literal("lead"),
      t.Literal("manager"),
      t.Literal("director"),
    ]),
  ),
  excludedCompanies: t.Array(t.String()),
});

const profileField = t.Object({ value: nullableString, share: t.Boolean() });

const profileFields = t.Object({
  phone: profileField,
  city: profileField,
  linkedin: profileField,
  portfolio: profileField,
  workAuthorization: profileField,
  availability: profileField,
  noticePeriod: profileField,
  salaryExpectation: profileField,
});

const preferencesResponse = t.Object({
  mode,
  hybridThreshold: t.Integer(),
  targetTitles: t.Array(t.String()),
  jobPreferences,
  profileFields,
});

export function preferencesRoutes(
  repos: PreferencesRepository,
  talentAccess: TalentAccessPlugin,
  onTitlesChanged: (profileId: string) => Promise<void>,
) {
  return new Elysia()
    .use(talentAccess)
    .get("/me/preferences", ({ me }) => repos.get(me.id), {
      talent: "active",
      response: preferencesResponse,
    })
    .put(
      "/me/preferences",
      async ({ me, body, status }) => {
        const input = preferencesInputSchema.safeParse(body);

        if (!input.success) return status(422, invalid);

        const saved = await repos.save(me.id, input.data, new Date());

        if (saved.titlesChanged) await onTitlesChanged(me.id);

        return saved.preferences;
      },
      {
        talent: "active",
        body: t.Partial(
          t.Object({
            mode,
            hybridThreshold: t.Number(),
            targetTitles: t.Array(t.String()),
            jobPreferences: t.Partial(jobPreferences),
            profileFields: t.Partial(profileFields),
          }),
          { minProperties: 1, additionalProperties: false },
        ),
        response: { 200: preferencesResponse, 422: errorResponse },
        error: ({ code, status }) => (code === "VALIDATION" ? status(422, invalid) : undefined),
      },
    );
}
