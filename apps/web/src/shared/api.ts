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
