import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse } from "../../shared/http.js";
import type { FeedsRepository } from "./repository.js";

const provider = t.Union([t.Literal("greenhouse"), t.Literal("lever")]);

const feedResponse = t.Object({
  id: t.String(),
  provider,
  board: t.String(),
  companyLabel: t.Nullable(t.String()),
  enabled: t.Boolean(),
  lastSyncedAt: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  openJobs: t.Number(),
});

const companyLabel = t.String({ maxLength: 255 });

const feedParams = t.Object({ id: t.String({ format: "uuid" }) });

const label = (value: string | null | undefined) => value?.trim() || null;

export function feedsRoutes(
  repos: FeedsRepository,
  access: PortalAccessPlugin,
  onCreated: (feedId: string) => Promise<void>,
) {
  return new Elysia()
    .use(access)
    .get("/job-feeds", () => repos.list(), {
      permit: ["manage", "Integrations"],
      response: t.Array(feedResponse),
    })
    .post(
      "/job-feeds",
      async ({ body, set, status }) => {
        const feed = await repos.create({
          provider: body.provider,
          board: body.board,
          companyLabel: label(body.companyLabel),
        });

        if (feed === "exists") return status(409, { error: "Feed already exists" });

        await onCreated(feed.id);
        set.status = 201;

        return feed;
      },
      {
        permit: ["manage", "Integrations"],
        body: t.Object({
          provider,
          board: t.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,99}$" }),
          companyLabel: t.Optional(companyLabel),
        }),
        response: { 201: feedResponse, 409: errorResponse },
      },
    )
    .patch(
      "/job-feeds/:id",
      async ({ params, body, status }) => {
        const feed = await repos.update(params.id, {
          enabled: body.enabled,
          companyLabel: body.companyLabel === undefined ? undefined : label(body.companyLabel),
        });

        return feed ?? status(404, { error: "Feed not found" });
      },
      {
        permit: ["manage", "Integrations"],
        params: feedParams,
        body: t.Object(
          {
            enabled: t.Optional(t.Boolean()),
            companyLabel: t.Optional(t.Nullable(companyLabel)),
          },
          { minProperties: 1 },
        ),
        response: { 200: feedResponse, 404: errorResponse },
      },
    )
    .delete(
      "/job-feeds/:id",
      async ({ params, status }) =>
        (await repos.remove(params.id))
          ? new Response(null, { status: 204 })
          : status(404, { error: "Feed not found" }),
      {
        permit: ["manage", "Integrations"],
        params: feedParams,
        response: { 204: t.Void(), 404: errorResponse },
      },
    );
}
