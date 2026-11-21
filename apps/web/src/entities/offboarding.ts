import { queryOptions } from "@tanstack/react-query";
import { fetchDashboardCases, fetchOffboarding, fetchOffboardings } from "../shared/api";

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
  status: "done" | "inProgress" | "todo";
};

export type OffboardingCase = CaseSummary & { tasks: Task[] };

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
];

export const offboardingsQuery = queryOptions({
  queryKey: ["offboardings"],
  queryFn: fetchOffboardings,
});

export const dashboardQuery = queryOptions({
  queryKey: ["offboardings", "dashboard"],
  queryFn: fetchDashboardCases,
});

export function offboardingDetailQuery(caseId: string) {
  return queryOptions({
    queryKey: ["offboardings", caseId],
    queryFn: () => fetchOffboarding(caseId),
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
