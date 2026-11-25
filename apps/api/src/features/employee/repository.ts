import { randomUUID } from "node:crypto";
import type { Database } from "@offboard/db/client";
import { authSession, employeeAccess, employeeStates, offboardingCases } from "@offboard/db/schema";
import {
  emptyEmployeePlan,
  employeeAccessSchema,
  employeePlanSchema,
  employeeStateSchema,
  type EmployeeState,
} from "@offboard/employee";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { EmployeePrincipal } from "../../shared/employee-auth.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type EmployeeData = {
  readJourney(): {
    deadline: string;
    role: string;
    department: string;
    plan: z.infer<typeof employeePlanSchema>;
  };
  readState(key: EmployeeState["key"]): ReturnType<typeof readState>;
  saveState(next: EmployeeState): ReturnType<typeof saveState>;
};

export function createEmployeeRepository(db: Database) {
  async function readSettings(orgId: string, caseId: string) {
    const [settings] = await db
      .select({
        email: employeeAccess.email,
        plan: employeeAccess.plan,
        revision: employeeAccess.revision,
      })
      .from(offboardingCases)
      .leftJoin(employeeAccess, eq(offboardingCases.id, employeeAccess.caseId))
      .where(and(eq(offboardingCases.id, caseId), eq(offboardingCases.orgId, orgId)));

    return settings
      ? employeeAccessSchema.parse({
          email: settings.email,
          plan: settings.plan ?? emptyEmployeePlan,
          revision: settings.revision ?? 0,
        })
      : null;
  }

  async function saveSettings(
    orgId: string,
    caseId: string,
    settings: z.infer<typeof employeeAccessSchema>,
  ) {
    try {
      return await db.transaction(async (tx) => {
        const [owned] = await tx
          .select({ id: offboardingCases.id })
          .from(offboardingCases)
          .where(and(eq(offboardingCases.id, caseId), eq(offboardingCases.orgId, orgId)));

        if (!owned) return "missing-case";

        const revision = settings.revision + 1;
        const { email, plan } = settings;

        if (settings.revision === 0) {
          const [created] = await tx
            .insert(employeeAccess)
            .values({ orgId, caseId, email, plan, revision })
            .onConflictDoNothing({ target: employeeAccess.caseId })
            .returning({ caseId: employeeAccess.caseId });

          return created ? "saved" : "changed";
        }

        const [current] = await tx
          .select({ email: employeeAccess.email, revision: employeeAccess.revision })
          .from(employeeAccess)
          .where(eq(employeeAccess.caseId, caseId))
          .for("update");

        if (!current || current.revision !== settings.revision) return "changed";

        const changedEmail = current.email !== email;

        await tx
          .update(employeeAccess)
          .set({ email, plan, revision, grantId: changedEmail ? randomUUID() : undefined })
          .where(eq(employeeAccess.caseId, caseId));

        if (changedEmail) {
          await tx.delete(authSession).where(eq(authSession.employeeCaseId, caseId));
        }

        return "saved";
      });
    } catch (error) {
      const cause = Object.getOwnPropertyDescriptor(Object(error), "cause")?.value;
      const code = Object.getOwnPropertyDescriptor(Object(cause), "code")?.value;

      if (code === "23505") return "email-in-use";

      throw error;
    }
  }

  async function withAccess<T>(
    principal: EmployeePrincipal,
    mode: "read" | "write",
    operation: (data: EmployeeData) => Promise<T>,
  ) {
    return db.transaction(async (tx) => {
      const [access] = await tx
        .select({
          orgId: offboardingCases.orgId,
          deadline: offboardingCases.deadline,
          role: offboardingCases.role,
          department: offboardingCases.department,
          plan: employeeAccess.plan,
        })
        .from(employeeAccess)
        .innerJoin(offboardingCases, eq(offboardingCases.id, employeeAccess.caseId))
        .where(
          and(
            eq(employeeAccess.caseId, principal.caseId),
            eq(employeeAccess.grantId, principal.grantId),
            eq(sql`lower(${employeeAccess.email})`, principal.email.toLowerCase()),
          ),
        )
        .for(mode === "write" ? "update" : "share", { of: employeeAccess });

      if (!access) return null;

      const { orgId, ...journey } = access;

      return operation({
        readJourney: () => ({ ...journey, plan: employeePlanSchema.parse(journey.plan) }),
        readState: (key) => readState(tx, principal, key),
        saveState: (next) => saveState(tx, orgId, principal, next),
      });
    });
  }

  return { readSettings, saveSettings, withAccess };
}

function stateOwner(principal: EmployeePrincipal, key: EmployeeState["key"]) {
  return and(
    eq(employeeStates.caseId, principal.caseId),
    eq(employeeStates.userId, principal.id),
    eq(employeeStates.key, key),
  );
}

async function readState(tx: Transaction, principal: EmployeePrincipal, key: EmployeeState["key"]) {
  const [record] = await tx
    .select({
      key: employeeStates.key,
      revision: employeeStates.revision,
      value: employeeStates.value,
    })
    .from(employeeStates)
    .where(stateOwner(principal, key));

  return record ? employeeStateSchema.parse(record) : null;
}

async function saveState(
  tx: Transaction,
  orgId: string,
  principal: EmployeePrincipal,
  next: EmployeeState,
) {
  const owner = stateOwner(principal, next.key);
  const revision = next.revision + 1;
  const revisionMatch = and(owner, eq(employeeStates.revision, next.revision));

  const [saved] =
    next.revision === 0
      ? await tx
          .insert(employeeStates)
          .values({
            orgId,
            caseId: principal.caseId,
            userId: principal.id,
            key: next.key,
            revision,
            value: next.value,
          })
          .onConflictDoNothing()
          .returning({ revision: employeeStates.revision })
      : await tx
          .update(employeeStates)
          .set({ revision, value: next.value })
          .where(revisionMatch)
          .returning({ revision: employeeStates.revision });

  if (saved) return { ...next, revision: saved.revision };

  const [alreadySaved] = await tx
    .select({ revision: employeeStates.revision })
    .from(employeeStates)
    .where(
      and(
        owner,
        eq(employeeStates.revision, revision),
        sql`${employeeStates.value} = ${JSON.stringify(next.value)}::jsonb`,
      ),
    );

  return alreadySaved ? { ...next, revision: alreadySaved.revision } : null;
}

export type EmployeeRepository = ReturnType<typeof createEmployeeRepository>;
