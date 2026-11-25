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
