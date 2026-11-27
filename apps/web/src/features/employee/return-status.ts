export type ReturnTracking = { delivered: boolean; lastEvent: string; lastUpdate: string };

export function returnStatus(
  trackingCode: string | null,
  tracking: ReturnTracking | null | undefined,
) {
  if (!trackingCode) return { label: "Aguardando postagem", detail: null };

  if (!tracking) return { label: "Postado", detail: null };

  if (tracking.delivered) return { label: "Entregue", detail: tracking.lastEvent };

  if (tracking.lastUpdate) return { label: "Em trânsito", detail: tracking.lastEvent };

  return { label: "Aguardando coleta", detail: null };
}
