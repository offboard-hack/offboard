import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse, uniqueViolation } from "../../shared/http.js";
import { memberRole, portalPrincipalResponse, type PortalAuth } from "../../shared/portal-auth.js";
import type { TeamRepository } from "./repository.js";

export function teamRoutes(repos: TeamRepository, access: PortalAccessPlugin, auth: PortalAuth) {
  return new Elysia()
    .use(access)
    .get("/team", () => repos.listTeamMembers(), {
      permit: ["read", "Team"],
      response: t.Array(portalPrincipalResponse),
    })
    .post(
      "/team",
      async ({ body, set, status }) => {
        try {
          const created = await repos.createTeamMember(body);
          set.status = 201;

          return created;
        } catch (error) {
          if (uniqueViolation.safeParse(error).success) {
            return status(409, { error: "Team member already exists" });
          }

          throw error;
        }
      },
      {
        permit: ["manage", "Team"],
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 255 }),
          email: t.String({ format: "email", maxLength: 255 }),
          role: memberRole,
        }),
        response: { 201: portalPrincipalResponse, 409: errorResponse },
      },
    )
    .put(
      "/team/:id",
      async ({ params, body, request, status }) => {
        const access = await auth.resolvePrincipal(request.headers);

        if (access.kind === "authenticated" && access.principal.id === params.id) {
          return status(403, { error: "Cannot change your own role" });
        }

        const updated = await repos.updateTeamMemberRole(params.id, body.role);

        return updated ?? status(404, { error: "Team member not found" });
      },
      {
        permit: ["manage", "Team"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({ role: memberRole }),
        response: { 200: portalPrincipalResponse, 403: errorResponse, 404: errorResponse },
      },
    )
    .delete(
      "/team/:id",
      async ({ params, status }) => {
        const removed = await repos.deleteTeamMember(params.id);

        return removed
          ? new Response(null, { status: 204 })
          : status(404, { error: "Team member not found" });
      },
      {
        permit: ["manage", "Team"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 204: t.Void(), 404: errorResponse },
      },
    );
}
