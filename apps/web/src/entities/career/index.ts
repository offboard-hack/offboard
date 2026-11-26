import type { ApiClient, Treaty } from "@offboard/api-client";
import { type QueryClient, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  checkEmployeeAccess,
  type EmployeeAccount,
  employeeAccessHeaders,
  employeeAccountQueryKey,
  retryEmployeeRead,
} from "@/entities/employee";
import { getApiClient } from "@/shared/lib/api-client";
import { careerFailure } from "./failure";
import { jobsRefetchInterval, resumeRefetchInterval, scoreArrived } from "./refresh";

export { jobsRefetchInterval } from "./refresh";

type Me = ApiClient["api"]["me"];

export type CareerProfile = Treaty.Data<Me["get"]>;

export type CareerResume = Treaty.Data<Me["resume"]["get"]>;

export type ResumeSuggestion = Treaty.Data<Me["resume"]["suggestions"]["get"]>[number];

export type CareerJobsPage = Treaty.Data<Me["jobs"]["get"]>;

export type JobsView = "compatible" | "all";

export type CareerJob = CareerJobsPage["items"][number];

export type WorkModel = NonNullable<CareerJob["workModel"]>;

export type CareerApplication = Treaty.Data<Me["applications"]["get"]>[number];

export type ApplicationsSummary = Treaty.Data<Me["applications"]["summary"]["get"]>;

export type AiAttempt = Treaty.Data<Me["ai-applications"]["get"]>["items"][number];

export type ConfirmAnswers = Parameters<
  ReturnType<Me["ai-applications"]>["confirm"]["post"]
>[0]["answers"];

function settle<Data, Failure extends { status: number }>(
  result: { data: Data | null; error: Failure | null; status: number },
  fallback: string,
) {
  checkEmployeeAccess(result.status);

  if (result.error !== null || result.data === null) {
    throw new Error(careerFailure(result.status, result.error) ?? fallback);
  }

  return result.data;
}

function settleEmpty<Failure extends { status: number }>(
  result: { error: Failure | null; status: number },
  fallback: string,
) {
  checkEmployeeAccess(result.status);

  if (result.error !== null)
    throw new Error(careerFailure(result.status, result.error) ?? fallback);
}

const freshness = 30_000;

function careerKey(account: EmployeeAccount) {
  return [...employeeAccountQueryKey(account), "talent"] as const;
}

function client() {
  return getApiClient().api.me;
}

export function careerProfileQuery(account: EmployeeAccount) {
  return queryOptions({
    queryKey: [...careerKey(account), "me"],
    staleTime: freshness,
    retry: retryEmployeeRead,
    queryFn: async ({ signal }) =>
      settle(
        await client().get({ headers: employeeAccessHeaders(account), fetch: { signal } }),
        "Não foi possível abrir sua carreira.",
      ),
  });
}

function resumeSource(account: EmployeeAccount) {
  const queryKey = [...careerKey(account), "resume"] as const;

  return queryOptions({
    queryKey,
    staleTime: freshness,
    retry: retryEmployeeRead,
    queryFn: async ({ signal, client: queryClient }) => {
      const result = await client().resume.get({
        headers: employeeAccessHeaders(account),
        fetch: { signal },
      });

      if (result.status === 404) return null;

      const resume = settle(result, "Não foi possível abrir seu currículo.");
      const previous = queryClient.getQueryData<CareerResume | null>(queryKey);

      if (scoreArrived(previous?.scoredAt, resume.scoredAt)) {
        void refreshAfterScore(queryClient, account);
      }

      return resume;
    },
  });
}

export function careerResumeQuery(account: EmployeeAccount) {
  return queryOptions({
    ...resumeSource(account),
    refetchInterval: (query) => resumeRefetchInterval(query.state.data),
  });
}

export function resumeSuggestionsQuery(account: EmployeeAccount) {
  return queryOptions({
    queryKey: [...careerKey(account), "resume", "suggestions"],
    staleTime: freshness,
    retry: retryEmployeeRead,
    queryFn: async ({ signal }) =>
      settle(
        await client().resume.suggestions.get({
          headers: employeeAccessHeaders(account),
          fetch: { signal },
        }),
        "Não foi possível abrir as sugestões.",
      ),
  });
}

function jobsSource(
  account: EmployeeAccount,
  view: JobsView,
  workModel: WorkModel | undefined,
  page: number,
) {
  return queryOptions({
    queryKey: [...careerKey(account), "jobs", view, workModel ?? "all", page],
    staleTime: freshness,
    retry: retryEmployeeRead,
    queryFn: async ({ signal }) =>
      settle(
        await client().jobs.get({
          query: { view, workModel, page },
          headers: employeeAccessHeaders(account),
          fetch: { signal },
        }),
        "Não foi possível abrir as vagas.",
      ),
  });
}

export function careerJobsQuery(
  account: EmployeeAccount,
  view: JobsView,
  workModel: WorkModel | undefined,
  page: number,
  hasResume = false,
) {
  return queryOptions({
    ...jobsSource(account, view, workModel, page),
    refetchInterval: (query) => jobsRefetchInterval(query.state.data, hasResume),
  });
}

export function careerApplicationsQuery(account: EmployeeAccount) {
  return queryOptions({
    queryKey: [...careerKey(account), "applications"],
    staleTime: freshness,
    retry: retryEmployeeRead,
    queryFn: async ({ signal }) =>
      settle(
        await client().applications.get({
          headers: employeeAccessHeaders(account),
          fetch: { signal },
        }),
        "Não foi possível abrir suas candidaturas.",
      ),
  });
}

export function applicationsSummaryQuery(account: EmployeeAccount) {
  return queryOptions({
    queryKey: [...careerKey(account), "applications", "summary"],
    staleTime: freshness,
    retry: retryEmployeeRead,
    queryFn: async ({ signal }) =>
      settle(
        await client().applications.summary.get({
          headers: employeeAccessHeaders(account),
          fetch: { signal },
        }),
        "Não foi possível abrir o resumo das candidaturas.",
      ),
  });
}

export function aiAttemptsQuery(account: EmployeeAccount) {
  return queryOptions({
    queryKey: [...careerKey(account), "ai-applications"],
    staleTime: freshness,
    retry: retryEmployeeRead,
    queryFn: async ({ signal }) =>
      settle(
        await client()["ai-applications"].get({
          headers: employeeAccessHeaders(account),
          fetch: { signal },
        }),
        "Não foi possível abrir as candidaturas com IA.",
      ).items,
  });
}

export function aiAttemptQuery(account: EmployeeAccount, id: string) {
  return queryOptions({
    queryKey: [...careerKey(account), "ai-applications", id],
    staleTime: freshness,
    retry: retryEmployeeRead,
    queryFn: async ({ signal }) =>
      settle(
        await client()
          ["ai-applications"]({ id })
          .get({ headers: employeeAccessHeaders(account), fetch: { signal } }),
        "Não foi possível abrir a candidatura com IA.",
      ),
  });
}

export function refreshAfterScore(queryClient: QueryClient, account: EmployeeAccount) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: resumeSuggestionsQuery(account).queryKey }),
    queryClient.invalidateQueries({ queryKey: [...careerKey(account), "jobs"] }),
  ]);
}

export function useResumeUpload(account: EmployeeAccount) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) =>
      settle(
        await client().resume.upload.post({ file }, { headers: employeeAccessHeaders(account) }),
        "Não foi possível enviar o currículo. Tente novamente.",
      ),
    onSuccess(resume) {
      queryClient.setQueryData(careerResumeQuery(account).queryKey, resume);

      return Promise.all([
        queryClient.invalidateQueries({ queryKey: resumeSuggestionsQuery(account).queryKey }),
        queryClient.invalidateQueries({ queryKey: [...careerKey(account), "jobs"] }),
      ]);
    },
  });
}

export function useSuggestionAction(account: EmployeeAccount) {
  const queryClient = useQueryClient();

  return useMutation({
    async mutationFn({ id, action }: { id: string; action: "apply" | "dismiss" }) {
      const suggestion = client().resume.suggestions({ id });
      const headers = employeeAccessHeaders(account);

      if (action === "dismiss") {
        settleEmpty(
          await suggestion.dismiss.post(undefined, { headers }),
          "Não foi possível dispensar a sugestão.",
        );

        return null;
      }

      return settle(
        await suggestion.apply.post(undefined, { headers }),
        "Não foi possível aplicar a sugestão.",
      );
    },
    onSuccess(resume) {
      if (resume) queryClient.setQueryData(careerResumeQuery(account).queryKey, resume);

      return queryClient.invalidateQueries({ queryKey: resumeSuggestionsQuery(account).queryKey });
    },
  });
}

export function useMarkApplied(account: EmployeeAccount) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ jobId, resumeId }: { jobId: string; resumeId: string }) =>
      settle(
        await client()
          .jobs({ jobId })
          .apply.post({ resumeId }, { headers: employeeAccessHeaders(account) }),
        "Não foi possível registrar a candidatura.",
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: [...careerKey(account), "jobs"] }),
        queryClient.invalidateQueries({ queryKey: careerApplicationsQuery(account).queryKey }),
        queryClient.invalidateQueries({ queryKey: aiAttemptsQuery(account).queryKey }),
      ]),
  });
}

export function useAiApplyConsent(account: EmployeeAccount) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () =>
      settle(
        await client()["ai-apply"].consent.put(
          { accept: true },
          { headers: employeeAccessHeaders(account) },
        ),
        "Não foi possível registrar seu consentimento.",
      ),
    onSuccess(profile) {
      queryClient.setQueryData(careerProfileQuery(account).queryKey, profile);
    },
  });
}

export class NotAiApplicable extends Error {
  constructor() {
    super(
      "Esta vaga não aceita candidatura com IA. Use “Abrir vaga” para se candidatar pelo site.",
    );
  }
}

const activeStates = new Set<AiAttempt["state"]>([
  "draft",
  "queued",
  "running",
  "submitting",
  "needs_check",
]);

export function useAiDraft(account: EmployeeAccount) {
  const queryClient = useQueryClient();

  return useMutation({
    async mutationFn(jobId: string) {
      const result = await client()
        .jobs({ jobId })
        ["ai-apply"].post(undefined, { headers: employeeAccessHeaders(account) });

      if (result.status === 404) throw new NotAiApplicable();

      if (result.status === 409) {
        const attempts = await queryClient.fetchQuery({
          ...aiAttemptsQuery(account),
          staleTime: 0,
        });

        const active = attempts.find(
          (attempt) => attempt.job.id === jobId && activeStates.has(attempt.state),
        );

        if (active) return active;
      }

      return settle(result, "Não foi possível preparar a candidatura.").attempt;
    },
    onSuccess(attempt) {
      queryClient.setQueryData(aiAttemptQuery(account, attempt.id).queryKey, attempt);

      return queryClient.invalidateQueries({
        queryKey: aiAttemptsQuery(account).queryKey,
        exact: true,
      });
    },
  });
}

export function useCoverLetter(account: EmployeeAccount) {
  return useMutation({
    mutationFn: async (jobId: string) =>
      settle(
        await client()
          .jobs({ jobId })
          ["cover-letter"].post(undefined, { headers: employeeAccessHeaders(account) }),
        "Não foi possível escrever a carta.",
      ),
  });
}

const runningStates = new Set<AiAttempt["state"]>(["queued", "running", "submitting"]);

export function isAttemptRunning(attempt: Pick<AiAttempt, "state">) {
  return runningStates.has(attempt.state);
}

export function aiAttemptProgressQuery(account: EmployeeAccount, id: string) {
  return queryOptions({
    ...aiAttemptQuery(account, id),
    refetchInterval: (query) =>
      query.state.data && isAttemptRunning(query.state.data) ? 2_000 : false,
  });
}

export function useAiRun(account: EmployeeAccount) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) =>
      settle(
        await client()
          ["ai-applications"]({ id })
          .run.post(undefined, { headers: employeeAccessHeaders(account) }),
        "Não foi possível iniciar o preenchimento.",
      ),
    onSuccess(attempt) {
      queryClient.setQueryData(aiAttemptQuery(account, attempt.id).queryKey, attempt);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: aiAttemptsQuery(account).queryKey }),
        queryClient.invalidateQueries({ queryKey: careerApplicationsQuery(account).queryKey }),
      ]),
  });
}

export function useAiConfirm(account: EmployeeAccount) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      answers,
      rehearsal,
    }: {
      id: string;
      answers: ConfirmAnswers;
      rehearsal: boolean;
    }) =>
      settle(
        await client()
          ["ai-applications"]({ id })
          .confirm.post({ answers, rehearsal }, { headers: employeeAccessHeaders(account) }),
        "Não foi possível confirmar a candidatura.",
      ),
    onSuccess(attempt) {
      queryClient.setQueryData(aiAttemptQuery(account, attempt.id).queryKey, attempt);

      return queryClient.invalidateQueries({
        queryKey: aiAttemptsQuery(account).queryKey,
        exact: true,
      });
    },
  });
}

export function useAiCheck(account: EmployeeAccount) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, sent }: { id: string; sent: boolean }) =>
      settle(
        await client()
          ["ai-applications"]({ id })
          .check.post({ sent }, { headers: employeeAccessHeaders(account) }),
        "Não foi possível registrar a resposta.",
      ),
    onSuccess(attempt) {
      queryClient.setQueryData(aiAttemptQuery(account, attempt.id).queryKey, attempt);

      return Promise.all([
        queryClient.invalidateQueries({ queryKey: aiAttemptsQuery(account).queryKey, exact: true }),
        queryClient.invalidateQueries({ queryKey: careerApplicationsQuery(account).queryKey }),
        queryClient.invalidateQueries({ queryKey: [...careerKey(account), "jobs"] }),
      ]);
    },
  });
}

export function resumePdfUrl(resumeId: string) {
  return `/api/me/resume/${encodeURIComponent(resumeId)}/pdf`;
}

export function aiScreenshotUrl(attemptId: string) {
  return `/api/me/ai-applications/${encodeURIComponent(attemptId)}/screenshot`;
}
