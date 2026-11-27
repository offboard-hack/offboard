import { describe, expect, it } from "vitest";
import { returnStatus } from "./return-status";

describe("returnStatus", () => {
  it("waits for the posting until a code is registered", () => {
    expect(returnStatus(null, null)).toEqual({ label: "Aguardando postagem", detail: null });
  });

  it("shows only that it was posted when tracking is unavailable", () => {
    expect(returnStatus("AB123456789BR", null)).toEqual({ label: "Postado", detail: null });
    expect(returnStatus("AB123456789BR", undefined)).toEqual({ label: "Postado", detail: null });
  });

  it("waits for the carrier until the first event", () => {
    expect(
      returnStatus("AB123456789BR", { delivered: false, lastEvent: "no data", lastUpdate: "" }),
    ).toEqual({ label: "Aguardando coleta", detail: null });
  });

  it("reports transit with the latest event", () => {
    expect(
      returnStatus("AB123456789BR", {
        delivered: false,
        lastEvent: "Objeto em trânsito",
        lastUpdate: "2026-11-18 16:00",
      }),
    ).toEqual({ label: "Em trânsito", detail: "Objeto em trânsito" });
  });

  it("reports delivery", () => {
    expect(
      returnStatus("AB123456789BR", {
        delivered: true,
        lastEvent: "Objeto entregue",
        lastUpdate: "2026-11-21 09:00",
      }),
    ).toEqual({ label: "Entregue", detail: "Objeto entregue" });
  });
});
