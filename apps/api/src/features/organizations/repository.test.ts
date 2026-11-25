import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { organizations, teamMembers } from "@offboard/db/schema";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrganizationsRepository } from "./repository.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!url)("createOrgWithAdmin", () => {
  const db = createClient(url ?? "");
  const repo = createOrganizationsRepository(db);

  beforeAll(() =>
    migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    }),
  );
  afterAll(() => db.$client.end());

  it("creates the organization and a lowercased admin member", async () => {
    const slug = `org-${randomUUID()}`;
    const email = `Admin-${randomUUID()}@Example.com`;

    const result = await repo.createOrgWithAdmin("Acme", slug, "Ada", `  ${email}  `);

    if (result === "slug-taken" || result === "email-in-use") throw new Error(result);

    const [org] = await db.select().from(organizations).where(eq(organizations.id, result.orgId));
    const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, result.memberId));

    expect(org).toMatchObject({ name: "Acme", slug });
    expect(member).toMatchObject({
      orgId: result.orgId,
      name: "Ada",
      email: email.toLowerCase(),
      role: "admin",
    });
  });

  it("rethrows errors that are not unique violations", async () => {
    await expect(
      repo.createOrgWithAdmin(
        "x".repeat(300),
        `org-${randomUUID()}`,
        "Ada",
        `${randomUUID()}@example.com`,
      ),
    ).rejects.toThrow();
  });

  it("reports a taken slug and leaves no member behind", async () => {
    const slug = `org-${randomUUID()}`;
    await repo.createOrgWithAdmin("Acme", slug, "Ada", `${randomUUID()}@example.com`);

    const email = `${randomUUID()}@example.com`;

    expect(await repo.createOrgWithAdmin("Other", slug, "Bob", email)).toBe("slug-taken");
    expect(await db.select().from(teamMembers).where(eq(teamMembers.email, email))).toHaveLength(0);
  });

  it("reports an email in use and rolls back the organization", async () => {
    const email = `${randomUUID()}@example.com`;
    await repo.createOrgWithAdmin("Acme", `org-${randomUUID()}`, "Ada", email);

    const slug = `org-${randomUUID()}`;

    expect(await repo.createOrgWithAdmin("Other", slug, "Bob", email.toUpperCase())).toBe(
      "email-in-use",
    );
    expect(await db.select().from(organizations).where(eq(organizations.slug, slug))).toHaveLength(
      0,
    );
  });
});
