import { queryOptions } from "@tanstack/react-query";
import type { Beneficiary, TeamMember } from "../features/app-access/access-page";
import type { Plan } from "../features/billing/billing-page";
import type { Equipment } from "../features/asset-returns/equipment-page";
import type { Integration } from "../features/integrations/integrations-page";
import type { CaseSummary, OffboardingCase } from "../entities/offboarding";

export const apiBase = import.meta.env.VITE_API_URL ?? "/api";

type OffboardingCaseDto = CaseSummary & {
  tasks: Array<{
    id: string;
    caseId: string;
    title: string;
    team: string;
    status: OffboardingCase["tasks"][number]["status"];
    position: number;
  }>;
};

export async function apiFetch<T>(path: string, init?: RequestInit) {
  const response = await fetch(apiBase + path, init);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    // WARNING: only callers that expect no body (void/unknown) hit this path.
    return undefined as T;
  }

  // WARNING: the response body is trusted to match T; no runtime validation.
  return (await response.json()) as T;
}

export function fetchOffboardings() {
  return apiFetch<CaseSummary[]>("/offboardings");
}

export async function fetchOffboarding(id: string) {
  const dto = await apiFetch<OffboardingCaseDto>("/offboardings/" + id);

  const offboardingCase: OffboardingCase = {
    ...dto,
    tasks: dto.tasks.map(({ id: taskId, title, team, status }) => ({
      id: taskId,
      title,
      team,
      status,
    })),
  };

  return offboardingCase;
}

export async function fetchDashboardCases() {
  const summaries = await fetchOffboardings();

  return Promise.all(summaries.map((summary) => fetchOffboarding(summary.id)));
}

type EquipmentDto = {
  id: string;
  item: string;
  tag: string;
  person: string;
  method: Equipment["method"];
  scheduledDate: string | null;
  status: "scheduled" | "received" | "failed" | "inventory" | "transit" | "with_person";
};

type IntegrationDto = {
  id: string;
  name: string;
  purpose: string;
  status: "connected" | "disconnected";
  lastActivity: string | null;
};

type BeneficiaryDto = {
  id: string;
  name: string;
  plan: string;
  status: string;
  accessUntil: string;
};

type TeamMemberDto = {
  id: string;
  name: string;
  role: string;
  accessScope: string;
  securityStatus: string;
};

type PlanDto = {
  id: string;
  name: string;
  priceCents: number;
  activeLicenses: number;
  capacity: number;
  costCenter: string;
};

type ChecklistRuleDto = {
  id: string;
  title: string;
  description: string;
  team: string;
  timing: string;
  required: boolean;
  enabled: boolean;
};

export type ChecklistRule = Omit<ChecklistRuleDto, "required">;

const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export async function fetchEquipment() {
  const dtos = await apiFetch<EquipmentDto[]>("/equipment");

  return dtos.map(
    ({ item, tag, person, method, scheduledDate, status }) =>
      ({
        item,
        tag,
        person,
        method,
        date: scheduledDate
          ? {
              iso: scheduledDate,
              label: shortDate
                .format(new Date(scheduledDate))
                .replace(" de ", " ")
                .replace(".", ""),
            }
          : null,
        status: status === "with_person" ? "withPerson" : status,
      }) satisfies Equipment,
  );
}

export async function fetchIntegrations() {
  const dtos = await apiFetch<IntegrationDto[]>("/integrations");

  return dtos.map(({ name, purpose, status, lastActivity }) =>
    status === "connected"
      ? ({ name, purpose, status, update: lastActivity ?? "" } satisfies Integration)
      : ({ name, purpose, status } satisfies Integration),
  );
}

export async function fetchBeneficiaries() {
  const dtos = await apiFetch<BeneficiaryDto[]>("/access/beneficiaries");

  return dtos.map(
    ({ name, plan, status, accessUntil }) =>
      ({ name, plan, status, until: accessUntil }) satisfies Beneficiary,
  );
}

export async function fetchTeamMembers() {
  const dtos = await apiFetch<TeamMemberDto[]>("/access/team-members");

  return dtos.map(
    ({ name, role, accessScope, securityStatus }) =>
      ({ name, role, access: accessScope, security: securityStatus }) satisfies TeamMember,
  );
}

export async function fetchPlans() {
  const dtos = await apiFetch<PlanDto[]>("/billing/plans");

  return dtos.map(
    ({ name, priceCents, activeLicenses, capacity, costCenter }) =>
      ({
        name,
        price: priceCents / 100,
        active: activeLicenses,
        capacity,
        area: costCenter,
      }) satisfies Plan,
  );
}

export async function fetchChecklist() {
  const dtos = await apiFetch<ChecklistRuleDto[]>("/checklist");
  const baseRules: ChecklistRule[] = [];
  const optionalRules: ChecklistRule[] = [];

  for (const { required, ...rule } of dtos) {
    (required ? baseRules : optionalRules).push(rule);
  }

  return { baseRules, optionalRules };
}

export async function toggleChecklistRule(id: string, enabled: boolean) {
  await apiFetch<unknown>("/checklist/" + id, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export function bulkCreateOffboardings(
  rows: Array<{ name: string; role: string; department: string; deadline: string }>,
) {
  return apiFetch<{ id: string }[]>("/offboardings/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });
}

export const checklistQuery = queryOptions({
  queryKey: ["checklist"],
  queryFn: fetchChecklist,
});

export const equipmentQuery = queryOptions({
  queryKey: ["equipment"],
  queryFn: fetchEquipment,
});

export const integrationsQuery = queryOptions({
  queryKey: ["integrations"],
  queryFn: fetchIntegrations,
});

export const beneficiariesQuery = queryOptions({
  queryKey: ["access", "beneficiaries"],
  queryFn: fetchBeneficiaries,
});

export const teamMembersQuery = queryOptions({
  queryKey: ["access", "team-members"],
  queryFn: fetchTeamMembers,
});

export const plansQuery = queryOptions({
  queryKey: ["billing", "plans"],
  queryFn: fetchPlans,
});
