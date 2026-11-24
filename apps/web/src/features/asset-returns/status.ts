import type { EquipmentStatus } from "@/entities/equipment";

export const equipmentStatusValues = [
  "in_use",
  "pending_return",
  "in_transit",
  "received",
  "in_inventory",
  "decommissioned",
] as const satisfies readonly EquipmentStatus[];

export const equipmentStatus: Record<EquipmentStatus, string> = {
  in_use: "Em uso",
  pending_return: "Devolução pendente",
  in_transit: "Em trânsito",
  received: "Recebido",
  in_inventory: "No estoque",
  decommissioned: "Baixado",
};

export const equipmentReturnMethod = {
  pickup: "Coleta em casa",
  in_person: "Entrega no escritório",
  correios: "Correios",
};

export const trackingStatus = {
  none: "Sem rastreio",
  loading: "Consultando",
  unavailable: "Rastreio indisponível",
  waiting: "Aguardando coleta",
  transit: "Em trânsito",
  delivered: "Entregue",
};

export function getTrackingStatus(
  trackingCode: string | null,
  tracking: { delivered: boolean; lastUpdate: string } | null | undefined,
) {
  if (!trackingCode) return "none";

  if (!tracking) return "loading";

  if (tracking.delivered) return "delivered";

  return tracking.lastUpdate ? "transit" : "waiting";
}
