import type { ApiClient, Treaty } from "@offboard/api-client";
import { employeeGrantHeader, type EmployeeState } from "@offboard/employee";
import { queryOptions, type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

export type EmployeeAccount = Treaty.Data<ApiClient["api"]["employee"]["session"]["get"]>;

export type EmployeeJourney = Treaty.Data<ApiClient["api"]["employee"]["journey"]["get"]>;

export const employeeQueryKey = ["employee"] as const;

export class EmployeeAccessChanged extends Error {
  constructor() {
    super("O acesso à jornada mudou. Entre novamente para continuar.");
  }
}

function checkEmployeeAccess(status: number) {
  if (status === 401 || status === 412) throw new EmployeeAccessChanged();
}

function employeeAccountQueryKey(account: EmployeeAccount) {
  return [...employeeQueryKey, account.id, account.caseId, account.grantId] as const;
}

export function removeOtherEmployeeQueries(queryClient: QueryClient, account: EmployeeAccount) {
  const scope = employeeAccountQueryKey(account);
  queryClient.removeQueries({
    queryKey: employeeQueryKey,
    predicate: (query) => scope.some((part, index) => part !== query.queryKey[index]),
  });
}

function accessHeaders(account: EmployeeAccount) {
  return { [employeeGrantHeader]: account.grantId };
}

function retryEmployeeRead(failureCount: number, error: Error) {
  return (
    typeof window !== "undefined" && !(error instanceof EmployeeAccessChanged) && failureCount < 3
  );
}

export function employeeJourneyQuery(account: EmployeeAccount) {
  return queryOptions({
    queryKey: [...employeeAccountQueryKey(account), "journey"],
    staleTime: 30_000,
    retry: retryEmployeeRead,
    queryFn: async ({ signal }) => {
      const result = await getApiClient().api.employee.journey.get({
        headers: accessHeaders(account),
        fetch: { signal },
      });

      checkEmployeeAccess(result.status);

      if (result.error) throw new Error("Não foi possível abrir sua jornada.");

      return result.data;
    },
  });
}

export function employeeStateQuery(account: EmployeeAccount, key: EmployeeState["key"]) {
  return queryOptions({
    queryKey: [...employeeAccountQueryKey(account), key],
    staleTime: 30_000,
    retry: retryEmployeeRead,
    refetchOnWindowFocus: key === "consent" ? "always" : true,
    queryFn: async ({ signal }) => {
      const result = await getApiClient()
        .api.employee.state({ key })
        .get({
          headers: accessHeaders(account),
          fetch: { signal },
        });

      checkEmployeeAccess(result.status);

      if (result.error) throw new Error("Não foi possível abrir os dados da sua conta.");

      return result.data;
    },
  });
}

export function useEmployeeWrite(account: EmployeeAccount) {
  const queryClient = useQueryClient();

  return useMutation({
    async mutationFn(state: EmployeeState) {
      const result = await getApiClient().api.employee.state.put(state, {
        headers: accessHeaders(account),
      });

      checkEmployeeAccess(result.status);

      if (result.status === 409) {
        await queryClient.invalidateQueries({
          queryKey: employeeStateQuery(account, state.key).queryKey,
        });
        throw new Error(
          "Os dados mudaram em outro dispositivo. Revise a versão atual e tente novamente.",
        );
      }

      const errorValue = result.error?.value;

      if (
        result.status === 403 &&
        errorValue &&
        "error" in errorValue &&
        errorValue.error === "Consent required"
      ) {
        throw new Error("Para salvar, aceite os termos em Perfil → Privacidade.");
      }

      if (result.status === 422) {
        void queryClient.invalidateQueries({ queryKey: employeeJourneyQuery(account).queryKey });
        throw new Error("Essa opção não está mais disponível. Confira os dados e tente novamente.");
      }

      if (result.error) throw new Error("Não foi possível salvar. Tente novamente.");

      return result.data;
    },
    onSuccess(state) {
      queryClient.setQueryData(employeeStateQuery(account, state.key).queryKey, state);

      if (state.key === "departure-v1")
        void queryClient.invalidateQueries({ queryKey: employeeJourneyQuery(account).queryKey });
    },
  });
}

export function useEmployeeChecklistWrite(account: EmployeeAccount) {
  const client = useQueryClient();

  return useMutation({
    async mutationFn({ taskId, done }: { taskId: string; done: boolean }) {
      const result = await getApiClient()
        .api.employee.checklist({ taskId })
        .patch({ done }, { headers: accessHeaders(account) });

      checkEmployeeAccess(result.status);

      if (result.error) throw new Error("Não foi possível atualizar a etapa. Tente novamente.");

      return result.data;
    },
    onSuccess(task) {
      client.setQueryData(
        employeeJourneyQuery(account).queryKey,
        (journey) =>
          journey && {
            ...journey,
            checklist: journey.checklist.map((item) =>
              item.id === task.id ? { ...item, status: task.status } : item,
            ),
          },
      );

      return client.invalidateQueries({ queryKey: employeeJourneyQuery(account).queryKey });
    },
  });
}

export function useEmployeeTrackingCode(account: EmployeeAccount) {
  const client = useQueryClient();

  return useMutation({
    async mutationFn(code: string) {
      const result = await getApiClient().api.employee["tracking-code"].patch(
        {
          code: code
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, ""),
        },
        { headers: accessHeaders(account) },
      );

      checkEmployeeAccess(result.status);

      if (result.error) throw new Error("Não foi possível salvar o código de rastreio.");

      return result.data;
    },
    onSuccess(data) {
      client.setQueryData(
        employeeJourneyQuery(account).queryKey,
        (journey) => journey && { ...journey, trackingCode: data.trackingCode },
      );
    },
  });
}
