import { randomUUID } from "node:crypto";
import type { Database } from "@offboard/db/client";
import {
  authRateLimit,
  authSession,
  authUser,
  employeeAccess,
  employeeStates,
  equipment,
  offboardingCases,
  organizations,
} from "@offboard/db/schema";
import {
  emptyEmployeePlan,
  employeeAccessSchema,
  employeeAccessSettingsSchema,
  employeePlanSchema,
  employeeStateSchema,
  type EmployeeState,
} from "@offboard/employee";
import {
  departureSchema,
  initialDeparture,
  type Booking,
  type Departure,
} from "@offboard/employee/departure";
import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { attachWaitingEquipment } from "../../shared/equipment-holder.js";
import type { EmployeePrincipal } from "../../shared/employee-auth.js";

import {
  readChecklist,
  readTrackingCode,
  setChecklistTask,
  setTrackingCode,
  setWorkflowTasks,
  syncDepartureTasks,
  type ChecklistChange,
} from "./checklist.js";
import { syncExitSurvey } from "./exit-survey.js";
import {
  allReceived,
  currentBooking,
  EquipmentAlreadyAssigned,
  isReceived,
  joinCurrentEmployee,
  joinDepartureState,
  readEquipment,
  setReceipt,
  syncEquipmentSchedule,
  syncPlanEquipment,
} from "./equipment.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type EmployeeData = {
  readJourney(): Promise<{
    deadline: string;
    role: string;
    department: string;
    plan: z.infer<typeof employeePlanSchema>;
    equipment: Awaited<ReturnType<typeof readEquipment>>;
    checklist: Awaited<ReturnType<typeof readChecklist>>;
    trackingCode: string | null;
  }>;
  setChecklistTask(taskId: string, done: boolean): ReturnType<typeof setChecklistTask>;
  setTrackingCode(code: string): ReturnType<typeof setTrackingCode>;
  syncDeparture(previous: Departure, next: Departure): Promise<ChecklistChange[]>;
  readState(key: EmployeeState["key"]): ReturnType<typeof readState>;
  saveState(next: EmployeeState): ReturnType<typeof saveState>;
};

const invitesPerCase = 3;
const inviteWindowMs = 24 * 60 * 60 * 1000;

export function createEmployeeRepository(db: Database) {
  async function readSettings(orgId: string, caseId: string) {
    const [settings] = await db
      .select({
        email: employeeAccess.email,
        personalEmail: employeeAccess.personalEmail,
        plan: employeeAccess.plan,
        revision: employeeAccess.revision,
        careerSponsoredUntil: employeeAccess.careerSponsoredUntil,
        defaultCareerSponsoredUntil: sql<string>`(${offboardingCases.deadline} + interval '3 months')::date`,
      })
      .from(offboardingCases)
      .leftJoin(
        employeeAccess,
        and(
          eq(offboardingCases.id, employeeAccess.caseId),
          eq(offboardingCases.orgId, employeeAccess.orgId),
        ),
      )
      .where(and(eq(offboardingCases.orgId, orgId), eq(offboardingCases.id, caseId)));

    return settings
      ? employeeAccessSettingsSchema.parse({
          email: settings.email,
          personalEmail: settings.personalEmail,
          plan: settings.plan ?? emptyEmployeePlan,
          revision: settings.revision ?? 0,
          careerSponsoredUntil:
            settings.careerSponsoredUntil ?? settings.defaultCareerSponsoredUntil,
          careerSponsoredIsDefault: settings.careerSponsoredUntil === null,
        })
      : null;
  }

  async function readInvitee(orgId: string, caseId: string) {
    const [invitee] = await db
      .select({
        email: employeeAccess.email,
        name: offboardingCases.name,
        company: organizations.name,
      })
      .from(offboardingCases)
      .innerJoin(organizations, eq(organizations.id, offboardingCases.orgId))
      .leftJoin(
        employeeAccess,
        and(
          eq(offboardingCases.id, employeeAccess.caseId),
          eq(offboardingCases.orgId, employeeAccess.orgId),
        ),
      )
      .where(and(eq(offboardingCases.orgId, orgId), eq(offboardingCases.id, caseId)));

    return invitee;
  }

  async function claimInvite(caseId: string) {
    const now = Date.now();
    const expired = sql`${authRateLimit.lastRequest} <= ${now - inviteWindowMs}`;

    const [row] = await db
      .insert(authRateLimit)
      .values({
        id: randomUUID(),
        key: `offboard:employee-invite:${caseId}`,
        count: 1,
        lastRequest: now,
      })
      .onConflictDoUpdate({
        target: authRateLimit.key,
        set: {
          count: sql`case when ${expired} then 1 else ${authRateLimit.count} + 1 end`,
          lastRequest: sql`case when ${expired} then ${now} else ${authRateLimit.lastRequest} end`,
        },
      })
      .returning({ count: authRateLimit.count });

    return row.count <= invitesPerCase;
  }

  function markInviteSent(orgId: string, caseId: string) {
    return db.transaction((tx) => setWorkflowTasks(tx, orgId, caseId, ["invite"], "done"));
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
          .where(and(eq(offboardingCases.orgId, orgId), eq(offboardingCases.id, caseId)))
          .for("update");

        if (!owned) return "missing-case";

        const revision = settings.revision + 1;
        const { email, personalEmail, plan, careerSponsoredUntil } = settings;

        if (settings.revision === 0) {
          const [created] = await tx
            .insert(employeeAccess)
            .values({ orgId, caseId, email, personalEmail, plan, revision, careerSponsoredUntil })
            .onConflictDoNothing({ target: employeeAccess.caseId })
            .returning({ caseId: employeeAccess.caseId });

          if (!created) return "changed";

          await attachWaitingEquipment(tx, orgId, caseId, [email, personalEmail]);
          await syncPlanEquipment(tx, orgId, caseId, plan.equipment);

          return email ? "email-set" : "saved";
        }

        const [current] = await tx
          .select({
            email: employeeAccess.email,
            plan: employeeAccess.plan,
            revision: employeeAccess.revision,
          })
          .from(employeeAccess)
          .where(and(eq(employeeAccess.orgId, orgId), eq(employeeAccess.caseId, caseId)))
          .for("update");

        if (!current || current.revision !== settings.revision) return "changed";

        const before = await readEquipment(
          tx,
          orgId,
          caseId,
          employeePlanSchema.parse(current.plan).equipment,
        );

        const changedEmail = current.email !== email;

        const previousDeparture = await readCurrentDeparture(tx, orgId, caseId);

        await tx
          .update(employeeAccess)
          .set({
            email,
            personalEmail,
            plan,
            revision,
            careerSponsoredUntil,
            grantId: changedEmail ? randomUUID() : undefined,
          })
          .where(and(eq(employeeAccess.orgId, orgId), eq(employeeAccess.caseId, caseId)));

        await attachWaitingEquipment(tx, orgId, caseId, [email, personalEmail]);
        await syncPlanEquipment(tx, orgId, caseId, plan.equipment);
        const after = await readEquipment(tx, orgId, caseId, plan.equipment);

        if (allReceived(before) !== allReceived(after)) {
          await setWorkflowTasks(
            tx,
            orgId,
            caseId,
            ["inventory"],
            allReceived(after) ? "done" : "todo",
          );
        }

        if (changedEmail) {
          await tx.delete(authSession).where(eq(authSession.employeeCaseId, caseId));
        }

        const currentDeparture = changedEmail
          ? await readCurrentDeparture(tx, orgId, caseId)
          : previousDeparture;

        await syncEquipmentSchedule(
          tx,
          orgId,
          caseId,
          previousDeparture.booking,
          currentDeparture.booking,
        );
        await syncDepartureTasks(tx, orgId, caseId, previousDeparture, currentDeparture);

        return changedEmail && email ? "email-set" : "saved";
      });
    } catch (error) {
      if (error instanceof EquipmentAlreadyAssigned) return "equipment-in-use";

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
            eq(employeeAccess.orgId, offboardingCases.orgId),
            eq(employeeAccess.grantId, principal.grantId),
            eq(sql`lower(${employeeAccess.email})`, principal.email.toLowerCase()),
          ),
        )
        .for(mode === "write" ? "update" : "share", { of: employeeAccess });

      if (!access) return null;

      const { orgId, ...journey } = access;

      return operation({
        async readJourney() {
          const plan = employeePlanSchema.parse(journey.plan);

          const [equipment, checklist, trackingCode] = await Promise.all([
            readEquipment(tx, orgId, principal.caseId, plan.equipment),
            readChecklist(tx, orgId, principal.caseId),
            readTrackingCode(tx, orgId, principal.caseId),
          ]);

          return { ...journey, plan, equipment, checklist, trackingCode };
        },
        setChecklistTask: (id, done) => setChecklistTask(tx, orgId, principal.caseId, id, done),
        setTrackingCode: (code) => setTrackingCode(tx, orgId, principal.caseId, code),
        async syncDeparture(previous, next) {
          if (JSON.stringify(previous.booking) !== JSON.stringify(next.booking)) {
            await syncEquipmentSchedule(
              tx,
              orgId,
              principal.caseId,
              previous.booking,
              next.booking,
            );
          }

          await syncExitSurvey(tx, orgId, principal.caseId, previous, next);

          return syncDepartureTasks(tx, orgId, principal.caseId, previous, next);
        },
        readState: (key) => readState(tx, principal, key),
        saveState: (next) => saveState(tx, orgId, principal, next),
      });
    });
  }

  async function listEquipmentReturns(orgId: string, caseId?: string) {
    const rows = await db
      .select({
        id: equipment.id,
        caseId: equipment.caseId,
        holderEmail: equipment.holderEmail,
        person: offboardingCases.name,
        code: equipment.tag,
        title: equipment.item,
        status: equipment.status,
        returnMethod: equipment.returnMethod,
        scheduledDate: equipment.scheduledDate,
        fromEmployeePlan: equipment.fromEmployeePlan,
        plan: employeeAccess.plan,
        state: employeeStates.value,
      })
      .from(equipment)
      .leftJoin(
        offboardingCases,
        and(eq(offboardingCases.id, equipment.caseId), eq(offboardingCases.orgId, equipment.orgId)),
      )
      .leftJoin(
        employeeAccess,
        and(eq(employeeAccess.caseId, equipment.caseId), eq(employeeAccess.orgId, equipment.orgId)),
      )
      .leftJoin(authUser, joinCurrentEmployee())
      .leftJoin(employeeStates, joinDepartureState())
      .where(and(eq(equipment.orgId, orgId), caseId ? eq(equipment.caseId, caseId) : undefined))
      .orderBy(asc(offboardingCases.name), asc(equipment.tag));

    return rows.map(({ plan, state, scheduledDate, returnMethod, ...row }) => {
      const booking = currentBooking(state);
      const method: Booking["method"] = returnMethod === "pickup" ? "pickup" : "office";

      const appointment =
        booking?.day === scheduledDate && booking.method === method ? booking : null;

      const model = plan
        ? (employeePlanSchema.parse(plan).equipment.find(({ code }) => code === row.code)?.model ??
          "")
        : "";

      return {
        ...row,
        model,
        method,
        received: isReceived(row.status),
        addressAvailable: appointment !== null,
        schedule: scheduledDate
          ? {
              day: scheduledDate,
              method,
              slot: appointment?.slot ?? null,
            }
          : null,
      };
    });
  }

  async function readCollectionBooking(orgId: string, caseId: string) {
    const [record] = await db
      .select({ plan: employeeAccess.plan, state: employeeStates.value })
      .from(employeeAccess)
      .leftJoin(authUser, joinCurrentEmployee())
      .leftJoin(employeeStates, joinDepartureState())
      .where(and(eq(employeeAccess.orgId, orgId), eq(employeeAccess.caseId, caseId)));

    if (!record) return null;

    const booking = currentBooking(record.state);

    return {
      address:
        booking?.method === "pickup"
          ? booking.address
          : booking
            ? employeePlanSchema.parse(record.plan).officeAddress
            : null,
    };
  }

  async function updateReceipt(orgId: string, caseId: string, code: string, received: boolean) {
    return db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: offboardingCases.id })
        .from(offboardingCases)
        .where(and(eq(offboardingCases.orgId, orgId), eq(offboardingCases.id, caseId)))
        .for("update");

      if (!owned) return null;

      await tx
        .select({ caseId: employeeAccess.caseId })
        .from(employeeAccess)
        .where(and(eq(employeeAccess.orgId, orgId), eq(employeeAccess.caseId, caseId)))
        .for("update");

      const changed = await setReceipt(tx, orgId, caseId, code, received);

      if (changed === null) return null;

      const items = await readEquipment(tx, orgId, caseId, []);
      const complete = allReceived(items);

      const changes =
        changed && (complete || !received)
          ? await setWorkflowTasks(tx, orgId, caseId, ["inventory"], complete ? "done" : "todo")
          : [];

      return { received, changes };
    });
  }

  return {
    readSettings,
    readInvitee,
    claimInvite,
    markInviteSent,
    saveSettings,
    withAccess,
    listEquipmentReturns,
    readCollectionBooking,
    updateReceipt,
  };
}

async function readCurrentDeparture(tx: Transaction, orgId: string, caseId: string) {
  const [state] = await tx
    .select({ value: employeeStates.value })
    .from(employeeAccess)
    .leftJoin(authUser, joinCurrentEmployee())
    .leftJoin(employeeStates, joinDepartureState())
    .where(and(eq(employeeAccess.orgId, orgId), eq(employeeAccess.caseId, caseId)));

  return state.value === null ? initialDeparture : departureSchema.parse(state.value);
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
