import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trackPackage, type TrackingConfig } from "./correios.ts";

describe("trackPackage", () => {
  let config: TrackingConfig;
  let responseBody = "";
  let responseStatus = 200;

  const server = createServer((_req, res) => {
    res.writeHead(responseStatus, { "content-type": "application/json" });
    res.end(responseBody);
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    // WARNING: listen(0) guarantees AddressInfo with a port
    const addr = server.address() as AddressInfo;

    config = {
      baseUrl: `http://127.0.0.1:${addr.port}`,
      user: "test@example.com",
      token: "test-token",
    };
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("detects a delivered package", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      codigo: "AB123456789BR",
      eventos: [
        {
          data: "20/11/2026",
          hora: "10:30",
          local: "SAO PAULO/SP",
          status: "Objeto entregue ao destinatário",
          subStatus: [],
        },
      ],
    });

    const result = await trackPackage("AB123456789BR", config);

    expect(result).toEqual({
      delivered: true,
      lastEvent: "Objeto entregue ao destinatário",
      lastUpdate: "20/11/2026 10:30",
    });
  });

  it("detects entregue in different casing", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      codigo: "CD987654321BR",
      eventos: [
        {
          data: "21/11/2026",
          hora: "08:00",
          local: "RIO DE JANEIRO/RJ",
          status: "Objeto Entregue",
          subStatus: [],
        },
      ],
    });

    const result = await trackPackage("CD987654321BR", config);

    expect(result.delivered).toBe(true);
  });

  it("reports in-transit as not delivered", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      codigo: "IJ777888999BR",
      eventos: [
        {
          data: "18/11/2026",
          hora: "16:00",
          local: "CURITIBA/PR",
          status: "Objeto em trânsito - por favor aguarde",
          subStatus: [],
        },
      ],
    });

    const result = await trackPackage("IJ777888999BR", config);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "Objeto em trânsito - por favor aguarde",
      lastUpdate: "18/11/2026 16:00",
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

  it("handles empty eventos array", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({ codigo: "ZZ222222222BR", eventos: [] });

    const result = await trackPackage("ZZ222222222BR", config);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "no data",
      lastUpdate: "",
    });
  });

  it("handles missing eventos", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({ codigo: "AA333333333BR" });

    const result = await trackPackage("AA333333333BR", config);

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
      user: "test@example.com",
      token: "test-token",
    };

    const result = await trackPackage("EE777777777BR", unreachable);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "network error",
      lastUpdate: "",
    });
  });
});
