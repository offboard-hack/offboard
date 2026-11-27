import { Elysia, t } from "elysia";
import { errorResponse } from "../../shared/http.js";
import type { StaffAccessPlugin } from "../../shared/staff-access.js";
import type { BackofficeRepository } from "./repository.js";

const pageQuery = t.Object({
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 25 })),
  offset: t.Optional(t.Integer({ minimum: 0, default: 0 })),
});

const idParams = t.Object({ id: t.String({ format: "uuid" }) });

export function backofficeRoutes(repo: BackofficeRepository, staff: StaffAccessPlugin) {
  return new Elysia()
    .use(staff)
    .get("/backoffice/summary", () => repo.summary(), { staff: true })
    .get(
      "/backoffice/organizations",
      ({ query }) =>
        repo.listOrganizations({ limit: query.limit ?? 25, offset: query.offset ?? 0 }),
      { staff: true, query: pageQuery },
    )
    .get(
      "/backoffice/organizations/:id",
      async ({ params, status }) => {
        const org = await repo.getOrganization(params.id);

        return org ?? status(404, { error: "Not found" });
      },
      { staff: true, params: idParams, response: { 404: errorResponse } },
    )
    .get(
      "/backoffice/talent",
      ({ query }) => repo.listTalent({ limit: query.limit ?? 25, offset: query.offset ?? 0 }),
      { staff: true, query: pageQuery },
    )
    .get("/backoffice/plans", () => repo.listPlans(), { staff: true });
}
