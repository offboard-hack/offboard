import type { Database } from "@offboard/db/client";
import { and, asc, eq } from "drizzle-orm";
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

  return {
    listTeamMembers,
    createTeamMember,
    deleteTeamMember,
  };
}

export type TeamRepository = ReturnType<typeof createTeamRepository>;
