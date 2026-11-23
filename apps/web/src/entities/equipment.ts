import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

export type EquipmentRow = Treaty.Data<ApiClient["api"]["equipment"]["get"]>[number];

export type EquipmentStatus = EquipmentRow["status"];

export type EquipmentReturnMethod = EquipmentRow["returnMethod"];

async function listEquipment({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api.equipment.get({ fetch: { signal } });

  if (error) throw new Error("Failed to fetch equipment");

  return data;
}

export const equipmentQuery = queryOptions({
  queryKey: ["equipment"],
  queryFn: listEquipment,
  staleTime: 30_000,
});
