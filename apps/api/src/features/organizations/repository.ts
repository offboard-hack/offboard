import { seedAutomationRules } from "@offboard/db/automation-rules";
import type { Database } from "@offboard/db/client";
import { organizations, teamMembers } from "@offboard/db/schema";
import { z } from "zod";
import { uniqueViolation } from "../../shared/http.js";

const slugViolation = z.object({ cause: z.object({ constraint: z.string().includes("slug") }) });

export function createOrganizationsRepository(db: Database) {
  async function createOrgWithAdmin(
    orgName: string,
    slug: string,
    adminName: string,
    adminEmail: string,
  ) {
    try {
      return await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({ name: orgName, slug })
          .returning({ id: organizations.id });

        const [member] = await tx
          .insert(teamMembers)
          .values({
            orgId: org.id,
            name: adminName,
            email: adminEmail.trim().toLowerCase(),
            role: "admin",
          })
          .returning({ id: teamMembers.id });

        await seedAutomationRules(tx, org.id);

        return { orgId: org.id, memberId: member.id };
      });
    } catch (error) {
      if (!uniqueViolation.safeParse(error).success) throw error;

      return slugViolation.safeParse(error).success ? "slug-taken" : "email-in-use";
    }
  }

  return { createOrgWithAdmin };
}

export type OrganizationsRepository = ReturnType<typeof createOrganizationsRepository>;
