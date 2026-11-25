import { z } from "zod";

const trackingEvent = z.object({
  data: z.string(),
  hora: z.string(),
  local: z.string(),
  status: z.string(),
  subStatus: z.array(z.string()).optional(),
});

const trackingResponse = z.object({
  codigo: z.string(),
  eventos: z.array(trackingEvent).optional(),
});

const DELIVERED_PATTERN = /\bentregue\b/i;

export interface TrackingConfig {
  baseUrl: string;
  user: string;
  token: string;
}

export async function trackPackage(trackingCode: string, config: TrackingConfig) {
  const params = new URLSearchParams({
    user: config.user,
    token: config.token,
    codigo: trackingCode,
  });

  const url = `${config.baseUrl}/track/json?${params}`;

  let response: Response;

  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
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

  const eventos = parsed.data.eventos;

  if (!eventos || eventos.length === 0) {
    return { delivered: false, lastEvent: "no data", lastUpdate: "" };
  }

  const latest = eventos[0];

  return {
    delivered: DELIVERED_PATTERN.test(latest.status),
    lastEvent: latest.status,
    lastUpdate: `${latest.data} ${latest.hora}`,
  };
}
