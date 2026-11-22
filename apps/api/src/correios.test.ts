import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trackPackage } from "./correios.ts";

describe("trackPackage", () => {
  let baseUrl: string;
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
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("detects a delivered package (BDE tipo 01)", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "BDE",
              tipo: "01",
              descricao: "Objeto entregue ao destinatário",
              dtHrCriado: "2026-11-20T10:30:00",
            },
          ],
        },
      ],
    });

    const result = await trackPackage("AB123456789BR", baseUrl);

    expect(result).toEqual({
      delivered: true,
      lastEvent: "Objeto entregue ao destinatário",
      lastUpdate: "2026-11-20T10:30:00",
    });
  });

  it("detects BDI tipo 01 as delivered", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "BDI",
              tipo: "01",
              descricao: "Objeto entregue",
              dtHrCriado: "2026-11-21T08:00:00",
            },
          ],
        },
      ],
    });

    const result = await trackPackage("CD987654321BR", baseUrl);

    expect(result.delivered).toBe(true);
  });

  it("detects BDR tipo 01 as delivered", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "BDR",
              tipo: "01",
              descricao: "Objeto devolvido",
              dtHrCriado: "2026-11-21T09:00:00",
            },
          ],
        },
      ],
    });

    const result = await trackPackage("EF111222333BR", baseUrl);

    expect(result.delivered).toBe(true);
  });

  it("does not mark BDE tipo 09 as delivered (failed attempt)", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "BDE",
              tipo: "09",
              descricao: "Tentativa de entrega não efetuada",
              dtHrCriado: "2026-11-19T14:00:00",
            },
          ],
        },
      ],
    });

    const result = await trackPackage("GH444555666BR", baseUrl);

    expect(result.delivered).toBe(false);
    expect(result.lastEvent).toBe("Tentativa de entrega não efetuada");
  });

  it("reports in-transit as not delivered", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "RO",
              tipo: "01",
              descricao: "Objeto em trânsito",
              dtHrCriado: "2026-11-18T16:00:00",
            },
          ],
        },
      ],
    });

    const result = await trackPackage("IJ777888999BR", baseUrl);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "Objeto em trânsito",
      lastUpdate: "2026-11-18T16:00:00",
    });
  });

  it("handles HTTP error responses", async () => {
    responseStatus = 500;
    responseBody = JSON.stringify({ error: "Internal Server Error" });

    const result = await trackPackage("XX000000000BR", baseUrl);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "HTTP 500",
      lastUpdate: "",
    });
  });

  it("handles invalid JSON response", async () => {
    responseStatus = 200;
    responseBody = "not json";

    const result = await trackPackage("YY111111111BR", baseUrl);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "invalid response",
      lastUpdate: "",
    });
  });

  it("handles empty objetos array", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({ objetos: [] });

    const result = await trackPackage("ZZ222222222BR", baseUrl);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "no data",
      lastUpdate: "",
    });
  });

  it("handles missing objetos", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({});

    const result = await trackPackage("AA333333333BR", baseUrl);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "no data",
      lastUpdate: "",
    });
  });

  it("handles no eventos with a mensagem", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      objetos: [
        {
          mensagem: "Objeto não encontrado",
          eventos: [],
        },
      ],
    });

    const result = await trackPackage("BB444444444BR", baseUrl);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "Objeto não encontrado",
      lastUpdate: "",
    });
  });

  it("handles no eventos without mensagem", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({ objetos: [{}] });

    const result = await trackPackage("CC555555555BR", baseUrl);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "no events",
      lastUpdate: "",
    });
  });

  it("handles response with wrong schema shape", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({ objetos: [{ eventos: [{ wrong: "shape" }] }] });

    const result = await trackPackage("DD666666666BR", baseUrl);

    expect(result).toEqual({
      delivered: false,
      lastEvent: "invalid response",
      lastUpdate: "",
    });
  });

  it("handles connection refused gracefully", async () => {
    const result = await trackPackage("EE777777777BR", "http://127.0.0.1:1");

    expect(result).toEqual({
      delivered: false,
      lastEvent: "network error",
      lastUpdate: "",
    });
  });
});
