import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

export type CaseSummary = Treaty.Data<ApiClient["api"]["offboardings"]["get"]>[number];

type CaseDetail = Treaty.Data<ReturnType<ApiClient["api"]["offboardings"]>["get"]>;

export type Task = CaseDetail["tasks"][number];

export type OffboardingCase = CaseDetail;

export const offboardingDepartments = [
  "Marketing",
  "Tecnologia",
  "Operações",
  "Financeiro",
  "Produto",
];

export const offboardingTeams = [
  "RH e DP",
  "TI",
  "Gestão",
  "Financeiro",
  "Jurídico",
  "Facilities",
  "Pessoa desligada",
] as const;

async function listOffboardings({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api.offboardings["with-tasks"].get({
    fetch: { signal },
  });

  if (error) throw new Error("Failed to fetch offboardings");

  return data;
}

const offboardingsStaleTime = 30_000;

export const offboardingsQuery = queryOptions({
  queryKey: ["offboardings"],
  queryFn: listOffboardings,
  staleTime: offboardingsStaleTime,
});

export function offboardingQuery(caseId: string, client: QueryClient) {
  return queryOptions<CaseDetail | null>({
    queryKey: ["offboardings", caseId],
    queryFn: async ({ signal }) => {
      const { data, error, status } = await getApiClient()
        .api.offboardings({ id: encodeURIComponent(caseId) })
        .get({ fetch: { signal } });

      if (status === 404) return null;

      if (error) throw new Error("Failed to fetch offboarding");

      return data;
    },
    staleTime: offboardingsStaleTime,
    initialData: () =>
      client.getQueryData(offboardingsQuery.queryKey)?.find(({ id }) => id === caseId),
    initialDataUpdatedAt: () => client.getQueryState(offboardingsQuery.queryKey)?.dataUpdatedAt,
  });
}

const deadlineFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDeadline(isoDate: string) {
  return deadlineFormat.format(new Date(isoDate)).replaceAll(" de ", " ").replace(".", "");
}

const exactDateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

export function formatExactDate(isoDate: string) {
  return exactDateFormat.format(new Date(isoDate));
}

const shortDeadlineFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function formatShortDeadline(isoDate: string) {
  return shortDeadlineFormat.format(new Date(isoDate)).replace(" de ", " ").replace(".", "");
}

const workspaceDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" });

export function todayAtWorkspace() {
  return workspaceDate.format(new Date());
}

export const caseStatusLabels = {
  overdue: "Em atraso",
  today: "Vence hoje",
  upcoming: "No prazo",
  complete: "Concluído",
};

export function getCaseStatus({ completed, deadline, total }: CaseSummary, today: string) {
  if (total > 0 && completed === total) return "complete";

  if (deadline < today) return "overdue";

  if (deadline === today) return "today";

  return "upcoming";
}

const nextStatus: Record<Task["status"], Task["status"]> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};

export function cycleTaskStatus(current: Task["status"]) {
  return nextStatus[current];
}

export async function toggleSubtask(subtaskId: string) {
  const { data, error } = await getApiClient()
    .api.subtasks({ id: encodeURIComponent(subtaskId) })
    .toggle.patch();

  if (error) throw new Error("Failed to toggle subtask");

  return data;
}

export async function updateTaskStatus(taskId: string, status: Task["status"]) {
  const result = await getApiClient()
    .api.tasks({ id: encodeURIComponent(taskId) })
    .status.patch({ status });

  if (result.error) throw new Error("Failed to update task status");

  return result.data;
}

export type TaskTracking = Treaty.Data<ReturnType<ApiClient["api"]["tasks"]>["tracking"]["get"]>;

export function taskTrackingQuery(taskId: string) {
  return queryOptions({
    queryKey: ["task-tracking", taskId],
    queryFn: async ({ signal }) => {
      const { data, error } = await getApiClient()
        .api.tasks({ id: encodeURIComponent(taskId) })
        .tracking.get({
          fetch: { signal },
        });

      if (error) throw new Error("Failed to fetch tracking");

      return data;
    },
    staleTime: 60_000,
  });
}

export async function applyCaseChecklist(caseId: string) {
  const { data, error, status } = await getApiClient()
    .api.offboardings({ id: caseId })
    .checklist.post();

  if (status === 409) throw new Error("Este desligamento já tem um checklist.");

  if (error) throw new Error("Não foi possível aplicar o checklist. Tente novamente.");

  return data;
}
