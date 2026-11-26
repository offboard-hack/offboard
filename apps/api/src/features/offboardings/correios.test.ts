import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trackPackage, type TrackingConfig } from "./correios.ts";

describe("trackPackage", () => {
  let config: TrackingConfig;
  let responseBody = "";
  let responseStatus = 200;
  let lastRequestBody = "";
  let lastAuthHeader = "";

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      lastRequestBody = Buffer.concat(chunks).toString();
      // WARNING: test server always receives the Authorization header
      lastAuthHeader = (req.headers.authorization as string) ?? "";
      res.writeHead(responseStatus, { "content-type": "application/json" });
      res.end(responseBody);
    });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    // WARNING: listen(0) guarantees AddressInfo with a port
    const addr = server.address() as AddressInfo;

    config = {
      baseUrl: `http://127.0.0.1:${addr.port}`,
      apiKey: "test-api-key",
    };
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("sends POST with correct authorization header", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: {
        temEventoEntrega: false,
        eventos: [
          {
            descricao: "Objeto em trânsito",
            dtHrCriado: { date: "2026-11-24 14:06:11.000000", timezone: "America/Sao_Paulo" },
          },
        ],
      },
    });

    await trackPackage("AB123456789BR", config);

    expect(lastAuthHeader).toBe("Apikey test-api-key");
    expect(JSON.parse(lastRequestBody)).toEqual({
      code: "AB123456789BR",
      carrier: "CARRIER_CORREIOS",
    });
  });

  it("detects a delivered package via temEventoEntrega", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: {
        temEventoEntrega: true,
        eventos: [
          {
            descricao: "Objeto entregue ao destinatário",
            dtHrCriado: { date: "2026-11-20 10:30:00.000000", timezone: "America/Sao_Paulo" },
          },
        ],
      },
    });

    const result = await trackPackage("AB123456789BR", config);

    expect(result).toEqual({
      delivered: true,
      lastEvent: "Objeto entregue ao destinatário",
      lastUpdate: "2026-11-20 10:30",
    });
  });

  it("reports in-transit as not delivered", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: {
        temEventoEntrega: false,
        eventos: [
          {
            descricao: "Objeto em transferência - por favor aguarde",
            dtHrCriado: { date: "2026-11-24 14:06:11.000000", timezone: "America/Sao_Paulo" },
          },
        ],
      },
    });

    const result = await trackPackage("IJ777888999BR", config);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "Objeto em transferência - por favor aguarde",
      lastUpdate: "2026-11-24 14:06",
    });
  });

  it("handles TRACKING_STATUS_NOT_FOUND", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      status: "TRACKING_STATUS_NOT_FOUND",
      carrier: "CARRIER_CORREIOS",
    });

    const result = await trackPackage("XX000000000BR", config);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "no data",
      lastUpdate: "",
    });
  });

  it("handles HTTP error responses", async () => {
    responseStatus = 500;
    responseBody = JSON.stringify({ error: "Internal Server Error" });

    const result = await trackPackage("XX000000000BR", config);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "HTTP 500",
      lastUpdate: "",
    });
  });

  it("handles invalid JSON response", async () => {
    responseStatus = 200;
    responseBody = "not json";

    const result = await trackPackage("YY111111111BR", config);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "invalid response",
      lastUpdate: "",
    });
  });

  it("handles missing dtHrCriado", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: {
        temEventoEntrega: false,
        eventos: [{ descricao: "Objeto em trânsito" }],
      },
    });

    const result = await trackPackage("MM555555555BR", config);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "Objeto em trânsito",
      lastUpdate: "",
    });
  });

  it("handles empty eventos array", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: { temEventoEntrega: false, eventos: [] },
    });

    const result = await trackPackage("ZZ222222222BR", config);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "no data",
      lastUpdate: "",
    });
  });

  it("handles response with wrong schema shape", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({ wrong: "shape" });

    const result = await trackPackage("DD666666666BR", config);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "invalid response",
      lastUpdate: "",
    });
  });

  it("handles connection refused gracefully", async () => {
    const unreachable: TrackingConfig = {
      baseUrl: "http://127.0.0.1:1",
      apiKey: "test-api-key",
    };

    const result = await trackPackage("EE777777777BR", unreachable);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "network error",
      lastUpdate: "",
    });
  });
});
