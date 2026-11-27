import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { getApiClient } from "@/shared/lib/api-client";

type EquipmentApi = ApiClient["api"]["equipment-returns"];

export type EquipmentReturn = Treaty.Data<EquipmentApi["get"]>[number];

export const equipmentStatus = {
  withPerson: "Com a pessoa",
  scheduled: "Devolução agendada",
  transit: "Em trânsito",
  received: "Recebido",
  inventory: "Conferido e no estoque",
  failed: "2 tentativas sem sucesso",
};

const inventoryStatus = {
  with_person: "withPerson",
  scheduled: "scheduled",
  transit: "transit",
  received: "received",
  inventory: "inventory",
  failed: "failed",
} satisfies Record<EquipmentReturn["status"], keyof typeof equipmentStatus>;

export function getEquipmentStatus({ status }: EquipmentReturn) {
  return inventoryStatus[status];
}

const equipmentReturnsKey = ["equipment-returns"] as const;

export const equipmentReturnsQuery = queryOptions({
  queryKey: equipmentReturnsKey,
  staleTime: 30_000,
  queryFn: async ({ signal }) => {
    const { data, error } = await getApiClient().api["equipment-returns"].get({
      fetch: { signal },
    });

    if (error) throw new Error("Não foi possível carregar o inventário.");

    return data;
  },
});

export function caseEquipmentQuery(caseId: string) {
  return queryOptions({
    queryKey: [...equipmentReturnsKey, caseId],
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await getApiClient()
        .api["equipment-returns"]({ caseId })
        .get({ fetch: { signal } });

      if (error) throw new Error("Não foi possível carregar os bens do caso.");

      return data;
    },
  });
}

export function collectionAddressQuery(caseId: string) {
  return queryOptions({
    queryKey: [...equipmentReturnsKey, caseId, "address"],
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await getApiClient()
        .api["equipment-returns"]({ caseId })
        .address.get({ fetch: { signal } });

      if (error) throw new Error("Não foi possível carregar o endereço.");

      return data;
    },
  });
}

export async function updateEquipmentReceipt({
  caseId,
  code,
  received,
}: Pick<EquipmentReturn, "caseId" | "code" | "received">) {
  const { data, error } = await getApiClient()
    .api["equipment-returns"]({ caseId })
    .receipt.patch({ code, received });

  if (error) throw new Error("Não foi possível atualizar o recebimento. Tente novamente.");

  return data;
}

const equipmentFailure = z.object({ error: z.string() });

export class EquipmentChangeError extends Error {
  constructor(readonly code: string | undefined) {
    super("Failed to change equipment");
  }
}

type EquipmentInput = {
  caseId: string;
  item: string;
  tag: string;
  returnMethod: "pickup" | "in_person";
};

function useEquipmentChange<Variables>(change: (variables: Variables) => Promise<void>) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: change,
    onSuccess: () => client.invalidateQueries({ queryKey: equipmentReturnsKey }),
  });
}

export function useSaveEquipment(id?: string) {
  return useEquipmentChange(async ({ caseId, ...fields }: EquipmentInput) => {
    const api = getApiClient().api.equipment;
    const { error } = id ? await api({ id }).patch(fields) : await api.post({ caseId, ...fields });

    if (error) throw new EquipmentChangeError(equipmentFailure.safeParse(error.value).data?.error);
  });
}

export function useRemoveEquipment(id: string) {
  return useEquipmentChange<void>(async () => {
    const { error } = await getApiClient().api.equipment({ id }).delete();

    if (error) throw new EquipmentChangeError(equipmentFailure.safeParse(error.value).data?.error);
  });
}
