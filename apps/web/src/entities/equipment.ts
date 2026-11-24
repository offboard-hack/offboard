import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

export type EquipmentRow = Treaty.Data<ApiClient["api"]["equipment"]["get"]>[number];

export type EquipmentStatus = EquipmentRow["status"];

export type EquipmentReturnMethod = NonNullable<EquipmentRow["returnMethod"]>;

export type EquipmentFilters = {
  status?: EquipmentStatus;
  assignedTo?: string;
  caseId?: string;
};

export type NewEquipment = Parameters<ApiClient["api"]["equipment"]["post"]>[0];

export type EquipmentChanges = Parameters<ReturnType<ApiClient["api"]["equipment"]>["put"]>[0];

export type EquipmentCaseLink = Parameters<
  ReturnType<ApiClient["api"]["equipment"]>["assign-case"]["post"]
>[0];

const equipmentKey = ["equipment"] as const;

async function listEquipment(filters: EquipmentFilters, signal: AbortSignal) {
  const { data, error } = await getApiClient().api.equipment.get({
    query: filters,
    fetch: { signal },
  });

  if (error) throw new Error("Failed to fetch equipment");

  return data;
}

export function equipmentQuery(filters: EquipmentFilters = {}) {
  return queryOptions({
    queryKey: [...equipmentKey, "list", filters],
    queryFn: ({ signal }) => listEquipment(filters, signal),
    staleTime: 30_000,
  });
}

async function listEquipmentByCase(caseId: string, signal: AbortSignal) {
  const { data, error } = await getApiClient()
    .api.equipment["by-case"]({ caseId: encodeURIComponent(caseId) })
    .get({ fetch: { signal } });

  if (error) throw new Error("Failed to fetch case equipment");

  return data;
}

export function equipmentByCaseQuery(caseId: string) {
  return queryOptions({
    queryKey: [...equipmentKey, "by-case", caseId],
    queryFn: ({ signal }) => listEquipmentByCase(caseId, signal),
    staleTime: 30_000,
  });
}

async function postEquipment(item: NewEquipment) {
  const { data, error } = await getApiClient().api.equipment.post(item);

  if (error) throw new Error("Failed to create equipment");

  return data;
}

async function putEquipment({ id, changes }: { id: string; changes: EquipmentChanges }) {
  const { data, error } = await getApiClient()
    .api.equipment({ id: encodeURIComponent(id) })
    .put(changes);

  if (error) throw new Error("Failed to update equipment");

  return data;
}

async function removeEquipment(id: string) {
  const { error } = await getApiClient()
    .api.equipment({ id: encodeURIComponent(id) })
    .delete();

  if (error) throw new Error("Failed to delete equipment");
}

async function postEquipmentCase({ id, link }: { id: string; link: EquipmentCaseLink }) {
  const { data, error } = await getApiClient()
    .api.equipment({ id: encodeURIComponent(id) })
    ["assign-case"].post(link);

  if (error) throw new Error("Failed to assign equipment");

  return data;
}

function useEquipmentMutation<Variables, Result>(
  mutationFn: (variables: Variables) => Promise<Result>,
) {
  const client = useQueryClient();

  return useMutation({
    mutationFn,
    onSettled: () => client.invalidateQueries({ queryKey: equipmentKey }),
  });
}

export function useCreateEquipment() {
  return useEquipmentMutation(postEquipment);
}

export function useUpdateEquipment() {
  return useEquipmentMutation(putEquipment);
}

export function useDeleteEquipment() {
  return useEquipmentMutation(removeEquipment);
}

export function useAssignEquipmentToCase() {
  return useEquipmentMutation(postEquipmentCase);
}
