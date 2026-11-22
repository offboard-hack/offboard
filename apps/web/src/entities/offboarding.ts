import { queryOptions } from "@tanstack/react-query";

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
  note?: string;
  subtasks?: { id: string; title: string; done: boolean }[];
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

export function apiBase() {
  if (typeof window === "undefined") {
    return process.env.API_URL ?? "http://localhost:3001";
  }

  return "";
}

async function listOffboardings() {
  const base = apiBase();
  const response = await fetch(`${base}/api/offboardings`);

  if (!response.ok) {
    throw new Error("Failed to fetch offboardings");
  }

  const summaries: CaseSummary[] = await response.json();

  return Promise.all(
    summaries.map(async (summary) => {
      const detail = await fetch(`${base}/api/offboardings/${encodeURIComponent(summary.id)}`);

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
