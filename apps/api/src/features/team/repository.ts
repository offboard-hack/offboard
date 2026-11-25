import type { Database } from "@offboard/db/client";
import { asc, eq } from "drizzle-orm";
import { teamMembers } from "@offboard/db/schema";

type NewTeamMember = Pick<typeof teamMembers.$inferInsert, "name" | "email" | "role">;

type MemberRole = NonNullable<typeof teamMembers.$inferInsert.role>;

export function createTeamRepository(db: Database) {
  const memberColumns = {
    id: teamMembers.id,
    name: teamMembers.name,
    email: teamMembers.email,
    role: teamMembers.role,
  };

  async function listTeamMembers() {
    return db.select(memberColumns).from(teamMembers).orderBy(asc(teamMembers.name));
  }

  async function createTeamMember({ name, email, role }: NewTeamMember) {
    const [row] = await db
      .insert(teamMembers)
      .values({ name, email: email.trim().toLowerCase(), role })
      .returning(memberColumns);

    return row;
  }

  async function updateTeamMemberRole(id: string, role: MemberRole) {
    const [row] = await db
      .update(teamMembers)
      .set({ role })
      .where(eq(teamMembers.id, id))
      .returning(memberColumns);

    return row ?? null;
  }

  async function deleteTeamMember(id: string) {
    const rows = await db
      .delete(teamMembers)
      .where(eq(teamMembers.id, id))
      .returning({ id: teamMembers.id });

    return rows.length > 0;
  }

  return {
    listTeamMembers,
    createTeamMember,
    updateTeamMemberRole,
    deleteTeamMember,
  };
}

export type TeamRepository = ReturnType<typeof createTeamRepository>;
