import { Elysia } from "elysia";
import { errorResponse } from "../../shared/http.js";
import { portalPrincipalResponse, type PortalAuth } from "../../shared/portal-auth.js";

export function authRoutes(auth: PortalAuth) {
  return new Elysia()
    .get("/auth/*", ({ request }) => auth.handler(request), { parse: "none" })
    .post("/auth/*", ({ request }) => auth.handler(request), { parse: "none" })
    .get(
      "/session",
      async ({ request, set, status }) => {
        set.headers["cache-control"] = "no-store";
        const access = await auth.resolvePrincipal(request.headers);

        if (access.kind === "anonymous") return status(401, { error: "Unauthorized" });

        if (access.kind === "forbidden") return status(403, { error: "Forbidden" });

        return access.principal;
      },
      { response: { 200: portalPrincipalResponse, 401: errorResponse, 403: errorResponse } },
    );
}
