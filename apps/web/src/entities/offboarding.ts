import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "@/shared/lib/api-fetch";

export type CaseSummary = {
  id: string;
  name: string;
  role: string;
  department: string;
  deadline: string;
  completed: number;
  total: number;
};

export type Task = {
  id: string;
  title: string;
  team: string;
  status: "done" | "in_progress" | "todo";
  description: string | null;
  dueDate: string | null;
  trackingCode: string | null;
  subtasks: { id: string; title: string; done: boolean }[];
};

export type PersonAsset = {
  item: string;
  tag: string;
  status: "withPerson" | "scheduled" | "transit" | "received" | "failed";
};

export type OffboardingCase = CaseSummary & { tasks: Task[]; assets?: PersonAsset[] };

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
  const response = await apiFetch("/api/offboardings", { signal });

  if (!response.ok) {
    throw new Error("Failed to fetch offboardings");
  }

  const summaries: CaseSummary[] = await response.json();

  return Promise.all(
    summaries.map(async (summary) => {
      const detail = await apiFetch(`/api/offboardings/${encodeURIComponent(summary.id)}`, {
        signal,
      });

      if (detail.status === 401 || detail.status === 403) {
        throw new Error("Portal access is required");
      }

      if (!detail.ok) {
        return { ...summary, tasks: [] };
      }

      const found: OffboardingCase = await detail.json();

      return found;
    }),
  );
}

export const offboardingsQuery = queryOptions({
  queryKey: ["offboardings"],
  queryFn: listOffboardings,
  staleTime: 30_000,
});

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
  const response = await fetch(`/api/subtasks/${encodeURIComponent(subtaskId)}/toggle`, {
    method: "PATCH",
  });

  if (!response.ok) {
    throw new Error("Failed to toggle subtask");
  }

  const updated: Task["subtasks"][number] = await response.json();

  return updated;
}

export async function updateTaskStatus(taskId: string, status: Task["status"]) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    throw new Error("Failed to update task status");
  }

  const updated: Task = await response.json();

  return updated;
}

export type TaskTracking = {
  trackingCode: string | null;
  tracking: { delivered: boolean; lastEvent: string; lastUpdate: string } | null;
};

export function taskTrackingQuery(taskId: string) {
  return queryOptions({
    queryKey: ["task-tracking", taskId],
    queryFn: async ({ signal }) => {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/tracking`, {
        signal,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch tracking");
      }

      const result: TaskTracking = await response.json();

      return result;
    },
    staleTime: 60_000,
  });
}
