import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

type ChecklistApi = ApiClient["api"]["checklist-model"];

export type ChecklistModel = Treaty.Data<ChecklistApi["get"]>;

export const checklistModelQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["checklist-model", orgId],
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await getApiClient().api["checklist-model"].get({
        fetch: { signal },
      });

      if (error) throw new Error("Não foi possível carregar o modelo do checklist.");

      return data;
    },
  });

export class ChecklistChanged extends Error {
  constructor() {
    super("O modelo foi atualizado em outra sessão. Seu rascunho continua nesta aba.");
  }
}

export async function saveChecklistModel(body: Parameters<ChecklistApi["put"]>[0]) {
  const { data, error, status } = await getApiClient().api["checklist-model"].put(body);

  if (status === 409) throw new ChecklistChanged();

  if (error) throw new Error("Não foi possível publicar o checklist. Tente novamente.");

  return data;
}
