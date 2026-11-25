import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse } from "../../shared/http.js";
import { jobShareFailures, type JobShareFailure } from "../../shared/job-share.js";
import type { RecruitersRepository } from "./repository.js";

const dailyLimit = 20;
const submitPath = "/recrutadoras/enviar";
const bearer = /^Bearer ([\w-]{1,256})$/;

type SubmittedJob = { id: string; title: string; company: string; url: string };

export type SubmitOutcome =
  | { kind: "existing" | "created"; job: SubmittedJob }
  | { kind: JobShareFailure };

const partnerResponse = t.Object({
  id: t.String(),
  name: t.String(),
  company: t.String(),
  revokedAt: t.Nullable(t.String()),
  createdAt: t.Nullable(t.String()),
});

const submittedJobResponse = t.Object({
  id: t.String(),
  title: t.String(),
  company: t.String(),
  url: t.String(),
});

const partnerText = t.String({ minLength: 1, maxLength: 255, pattern: "\\S" });

export function recruitersRoutes(
  repos: RecruitersRepository,
  access: PortalAccessPlugin,
  deps: {
    webOrigin: string;
    submit: (url: string, partnerId: string) => Promise<SubmitOutcome>;
    countToday: (partnerId: string, now: Date) => Promise<number>;
  },
) {
  return new Elysia()
    .use(access)
    .get("/recruiter-partners", () => repos.list(), {
      permit: ["manage", "Integrations"],
      response: t.Array(partnerResponse),
    })
    .post(
      "/recruiter-partners",
      async ({ body, set }) => {
        const { partner, token } = await repos.create(
          { name: body.name.trim(), company: body.company.trim() },
          new Date(),
        );

        set.status = 201;

        return { partner, token, submitUrl: `${deps.webOrigin}${submitPath}` };
      },
      {
        permit: ["manage", "Integrations"],
        body: t.Object({ name: partnerText, company: partnerText }),
        response: {
          201: t.Object({ partner: partnerResponse, token: t.String(), submitUrl: t.String() }),
        },
      },
    )
    .delete(
      "/recruiter-partners/:id",
      async ({ params, status }) =>
        (await repos.revoke(params.id, new Date()))
          ? new Response(null, { status: 204 })
          : status(404, { error: "Partner not found" }),
      {
        permit: ["manage", "Integrations"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 204: t.Void(), 404: errorResponse },
      },
    )
    .use(
      new Elysia()
        .derive(async ({ headers, set, status }) => {
          set.headers["cache-control"] = "no-store";

          const token = bearer.exec(headers.authorization ?? "")?.[1];
          const partner = token === undefined ? undefined : await repos.byToken(token);

          return partner ? { partner } : status(401, { error: "Unauthorized" });
        })
        .post(
          "/recruiters/jobs",
          async ({ body, partner, set, status }) => {
            if ((await deps.countToday(partner.id, new Date())) >= dailyLimit) {
              return status(429, { error: "Daily limit reached" });
            }

            const outcome = await deps.submit(body.url, partner.id);

            if (outcome.kind === "existing" || outcome.kind === "created") {
              set.status = outcome.kind === "created" ? 201 : 200;

              const { id, title, company, url } = outcome.job;

              return { id, title, company, url };
            }

            const failure = jobShareFailures[outcome.kind];

            return status(failure.status, { error: failure.error });
          },
          {
            body: t.Object({ url: t.String({ maxLength: 2048 }) }),
            response: {
              200: submittedJobResponse,
              201: submittedJobResponse,
              401: errorResponse,
              422: errorResponse,
              429: errorResponse,
              502: errorResponse,
              503: errorResponse,
            },
          },
        ),
    );
}
