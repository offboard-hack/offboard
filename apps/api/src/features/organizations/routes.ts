import { Elysia, t } from "elysia";
import type { OrganizationsRepository } from "./repository.js";

const reservedSlugs = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "billing",
  "help",
  "login",
  "signup",
  "status",
  "support",
  "www",
]);

const signupError = t.Object({ error: t.String(), code: t.String() });

export function organizationsRoutes(repos: OrganizationsRepository) {
  return new Elysia().post(
    "/signup",
    async ({ body, set, status }) => {
      if (reservedSlugs.has(body.slug))
        return status(409, { error: "Slug already in use", code: "slug-taken" });

      const result = await repos.createOrgWithAdmin(
        body.orgName,
        body.slug,
        body.adminName,
        body.adminEmail,
      );

      if (result === "slug-taken")
        return status(409, { error: "Slug already in use", code: "slug-taken" });

      if (result === "email-in-use")
        return status(409, { error: "Email already in use", code: "email-in-use" });

      set.status = 201;

      return { orgId: result.orgId, slug: body.slug };
    },
    {
      body: t.Object({
        orgName: t.String({ minLength: 1, maxLength: 255 }),
        slug: t.String({ minLength: 1, maxLength: 100, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
        adminName: t.String({ minLength: 1, maxLength: 255 }),
        adminEmail: t.String({ format: "email", maxLength: 255 }),
      }),
      response: {
        201: t.Object({ orgId: t.String(), slug: t.String() }),
        409: signupError,
      },
    },
  );
}
