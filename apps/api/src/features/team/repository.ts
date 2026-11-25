import type { Database } from "@offboard/db/client";
import { and, asc, eq, sql } from "drizzle-orm";
import { teamMembers } from "@offboard/db/schema";

type NewTeamMember = Pick<typeof teamMembers.$inferInsert, "name" | "email" | "role">;

export function createTeamRepository(db: Database) {
  const memberColumns = {
    id: teamMembers.id,
    name: teamMembers.name,
    email: teamMembers.email,
    role: teamMembers.role,
  };

  async function listTeamMembers(orgId: string) {
    return db
      .select(memberColumns)
      .from(teamMembers)
      .where(eq(teamMembers.orgId, orgId))
      .orderBy(asc(teamMembers.name));
  }

  async function createTeamMember(orgId: string, { name, email, role }: NewTeamMember) {
    const [row] = await db
      .insert(teamMembers)
      .values({ orgId, name, email: email.trim().toLowerCase(), role })
      .returning(memberColumns);

    return row;
  }

  async function deleteTeamMember(orgId: string, id: string) {
    const rows = await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.id, id), eq(teamMembers.orgId, orgId)))
      .returning({ id: teamMembers.id });

    return rows.length > 0;
  }

  async function updateTeamMemberRole(
    orgId: string,
    id: string,
    role: typeof teamMembers.$inferInsert.role,
  ) {
    return db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.id, id), eq(teamMembers.orgId, orgId)));

      if (!target) return null;

      if (target.role === "admin" && role !== "admin") {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(teamMembers)
          .where(and(eq(teamMembers.orgId, orgId), eq(teamMembers.role, "admin")));

        if (count <= 1) return "last-admin" as const;
      }

      const [row] = await tx
        .update(teamMembers)
        .set({ role, updatedAt: new Date() })
        .where(and(eq(teamMembers.id, id), eq(teamMembers.orgId, orgId)))
        .returning(memberColumns);

      return row;
    });
  }

  return {
    listTeamMembers,
    createTeamMember,
    deleteTeamMember,
    updateTeamMemberRole,
  };
}

export type TeamRepository = ReturnType<typeof createTeamRepository>;
