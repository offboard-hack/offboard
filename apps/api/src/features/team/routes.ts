import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse, uniqueViolation } from "../../shared/http.js";
import { memberRole, teamMemberResponse } from "../../shared/portal-auth.js";
import type { TeamRepository } from "./repository.js";

export function teamRoutes(repos: TeamRepository, access: PortalAccessPlugin) {
  return new Elysia()
    .use(access)
    .get("/team", ({ principal }) => repos.listTeamMembers(principal.orgId), {
      permit: ["read", "Team"],
      response: t.Array(teamMemberResponse),
    })
    .post(
      "/team",
      async ({ body, principal, set, status }) => {
        try {
          const created = await repos.createTeamMember(principal.orgId, body);
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
        response: { 201: teamMemberResponse, 409: errorResponse },
      },
    )
    .delete(
      "/team/:id",
      async ({ params, principal, status }) => {
        const removed = await repos.deleteTeamMember(principal.orgId, params.id);

        return removed
          ? new Response(null, { status: 204 })
          : status(404, { error: "Team member not found" });
      },
      {
        permit: ["manage", "Team"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 204: t.Void(), 404: errorResponse },
      },
    )
    .patch(
      "/team/:id",
      async ({ params, body, principal, status }) => {
        if (params.id === principal.id) return status(422, { error: "Cannot change own role" });

        const result = await repos.updateTeamMemberRole(principal.orgId, params.id, body.role);

        if (result === "last-admin") return status(422, { error: "Cannot demote the last admin" });

        if (!result) return status(404, { error: "Team member not found" });

        return result;
      },
      {
        permit: ["manage", "Team"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({ role: memberRole }),
        response: { 200: teamMemberResponse, 404: errorResponse, 422: errorResponse },
      },
    );
}
