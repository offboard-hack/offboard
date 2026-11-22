import { z } from "zod";

const correiosEvent = z.object({
  codigo: z.string(),
  tipo: z.string(),
  descricao: z.string(),
  dtHrCriado: z.string(),
});

const correiosObject = z.object({
  eventos: z.array(correiosEvent).optional(),
  mensagem: z.string().optional(),
});

const correiosResponse = z.object({
  objetos: z.array(correiosObject).optional(),
});

const DELIVERED_CODES = new Set(["BDE", "BDI", "BDR"]);

function isDelivered(codigo: string, tipo: string) {
  return DELIVERED_CODES.has(codigo) && tipo === "01";
}

export async function trackPackage(trackingCode: string, baseUrl: string) {
  const url = `${baseUrl}/v1/sro-rastro/${encodeURIComponent(trackingCode)}`;

  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        "app-check-token": "bypass",
        "user-agent": "Dart/3.6",
      },
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

  const parsed = correiosResponse.safeParse(body);

  if (!parsed.success) {
    return { delivered: false, lastEvent: "invalid response", lastUpdate: "" };
  }

  const objetos = parsed.data.objetos;

  if (!objetos || objetos.length === 0) {
    return { delivered: false, lastEvent: "no data", lastUpdate: "" };
  }

  const obj = objetos[0];

  if (!obj.eventos || obj.eventos.length === 0) {
    return { delivered: false, lastEvent: obj.mensagem ?? "no events", lastUpdate: "" };
  }

  const latest = obj.eventos[0];

  return {
    delivered: isDelivered(latest.codigo, latest.tipo),
    lastEvent: latest.descricao,
    lastUpdate: latest.dtHrCriado,
  };
}
