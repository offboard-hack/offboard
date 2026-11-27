import { describe, expect, it } from "vitest";
import { careerFailure, deleteAccountFailure } from "./failure";

describe("careerFailure", () => {
  it("translates a known API reason", () => {
    expect(careerFailure(403, { status: 403, value: { error: "AI Apply not available" } })).toBe(
      "Disponível no plano Platinum Premium da sua empresa ou no Carreira Pro.",
    );
  });

  it("explains the daily AI application limit", () => {
    expect(
      careerFailure(429, { status: 429, value: { error: "Daily AI application limit reached" } }),
    ).toBe("Você atingiu o limite de 10 candidaturas com IA hoje. Tente amanhã.");
  });

  it("explains checkout failures", () => {
    expect(careerFailure(503, { status: 503, value: { error: "Billing not configured" } })).toBe(
      "Indisponível no momento.",
    );
    expect(careerFailure(409, { status: 409, value: { error: "Already subscribed" } })).toBe(
      "Você já tem um pagamento em andamento. Tente de novo em alguns minutos.",
    );
    expect(
      careerFailure(502, { status: 502, value: { error: "Could not start the checkout" } }),
    ).toBe("Não foi possível abrir o pagamento. Tente de novo.");
  });

  it.each([
    ["Co-pay already active", "Você já tem um upgrade do benefício ativo."],
    [
      "Co-pay active",
      "Você tem um upgrade do benefício ativo. Cancele-o antes de assinar o Carreira Pro.",
    ],
    [
      "Co-pay checkout open",
      "Você já tem um pagamento de upgrade em andamento. Conclua-o ou tente de novo em alguns minutos.",
    ],
    [
      "Carreira Pro active",
      "Você já tem o Carreira Pro. Cancele-o antes de contratar o upgrade do benefício.",
    ],
    [
      "Carreira Pro checkout open",
      "Você já tem um pagamento do Carreira Pro em andamento. Tente de novo em alguns minutos.",
    ],
    ["No active co-pay", "Você não tem um upgrade do benefício ativo."],
    ["Could not cancel the co-pay", "Não foi possível cancelar o upgrade agora. Tente de novo."],
  ])("translates the co-pay and Carreira Pro exclusion reason %s", (error, message) => {
    expect(careerFailure(409, { status: 409, value: { error } })).toBe(message);
  });

  it("tells when a canceled Carreira Pro still has access", () => {
    expect(
      careerFailure(409, {
        status: 409,
        value: { error: "Carreira Pro canceled until 2026-12-26" },
      }),
    ).toBe("Seu Carreira Pro cancelado ainda vale até 26/12/2026.");
  });

  it("explains cancellation failures", () => {
    expect(
      careerFailure(502, { status: 502, value: { error: "Could not cancel Carreira Pro" } }),
    ).toBe("Não foi possível cancelar agora. Tente de novo.");
    expect(
      careerFailure(502, {
        status: 502,
        value: { error: "Could not cancel Carreira Pro; try again" },
      }),
    ).toBe("Não foi possível cancelar agora. Tente de novo.");
    expect(careerFailure(409, { status: 409, value: { error: "No active Carreira Pro" } })).toBe(
      "Você não tem um Carreira Pro ativo.",
    );
    expect(careerFailure(503, { status: 503, value: { error: "Billing not configured" } })).toBe(
      "Indisponível no momento.",
    );
  });

  it("falls back to the status when the reason is unknown", () => {
    expect(careerFailure(429, { status: 429, value: { error: "Something else" } })).toBe(
      "Limite diário de uso da IA atingido. Tente de novo amanhã.",
    );
    expect(careerFailure(503, { status: 503, value: { error: "AI not configured" } })).toBe(
      "Recurso indisponível no momento.",
    );
    expect(careerFailure(402, null)).toBe("Seu acesso à carreira terminou.");
  });

  it("leaves other failures to the caller", () => {
    expect(careerFailure(500, { status: 500, value: "oops" })).toBeUndefined();
    expect(careerFailure(422, { status: 422, value: { type: "validation" } })).toBeUndefined();
  });
});

describe("deleteAccountFailure", () => {
  const subscription =
    "Não foi possível cancelar sua assinatura agora. Tente de novo em alguns minutos.";

  it("maps both cancellation failures", () => {
    expect(
      deleteAccountFailure(502, {
        status: 502,
        value: { error: "Could not cancel Carreira Pro; try again" },
      }),
    ).toBe(subscription);
    expect(
      deleteAccountFailure(502, {
        status: 502,
        value: { error: "Could not cancel the benefit upgrade; try again" },
      }),
    ).toBe(subscription);
  });

  it("separates a storage failure", () => {
    expect(
      deleteAccountFailure(502, { status: 502, value: { error: "Could not delete stored files" } }),
    ).toBe("Não foi possível apagar seus arquivos agora. Tente de novo em alguns minutos.");
  });

  it("maps unavailable billing and storage", () => {
    const text = "Não é possível apagar agora. Tente mais tarde.";

    expect(
      deleteAccountFailure(503, { status: 503, value: { error: "Billing not configured" } }),
    ).toBe(text);
    expect(
      deleteAccountFailure(503, { status: 503, value: { error: "File storage not configured" } }),
    ).toBe(text);
  });

  it("falls back for anything else", () => {
    expect(deleteAccountFailure(500, null)).toBe(
      "Não foi possível apagar sua conta. Tente de novo.",
    );
  });

  it("handles a 502 without a readable body", () => {
    expect(deleteAccountFailure(502, "boom")).toBe(subscription);
  });
});
