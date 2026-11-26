import { z } from "zod";

const trackingEvent = z.object({
  descricao: z.string(),
  dtHrCriado: z.object({ date: z.string() }).optional(),
});

const trackingResponse = z.object({
  status: z.string(),
  payload: z
    .object({
      temEventoEntrega: z.boolean().optional(),
      eventos: z.array(trackingEvent).optional(),
    })
    .optional(),
});

export interface TrackingConfig {
  baseUrl: string;
  apiKey: string;
}

export async function trackPackage(trackingCode: string, config: TrackingConfig) {
  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}/wonca.labs.v1.LabsService/Track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Apikey ${config.apiKey}`,
      },
      body: JSON.stringify({ code: trackingCode, carrier: "CARRIER_CORREIOS" }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { delivered: false, lastEvent: "network error", lastUpdate: "" };
  }

  if (!response.ok) {
    return { delivered: false, lastEvent: `HTTP ${response.status}`, lastUpdate: "" };
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return { delivered: false, lastEvent: "invalid response", lastUpdate: "" };
  }

  const parsed = trackingResponse.safeParse(body);

  if (!parsed.success) {
    return { delivered: false, lastEvent: "invalid response", lastUpdate: "" };
  }

  if (parsed.data.status !== "TRACKING_STATUS_FOUND") {
    return { delivered: false, lastEvent: "no data", lastUpdate: "" };
  }

  const payload = parsed.data.payload;
  const eventos = payload?.eventos;

  if (!eventos || eventos.length === 0) {
    return { delivered: false, lastEvent: "no data", lastUpdate: "" };
  }

  const latest = eventos[0];
  const dateStr = latest.dtHrCriado?.date?.slice(0, 16) ?? "";

  return {
    delivered: payload?.temEventoEntrega === true,
    lastEvent: latest.descricao,
    lastUpdate: dateStr,
  };
}
