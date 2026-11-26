import { describe, expect, it } from "vitest";
import { careerFailure } from "./failure";

describe("careerFailure", () => {
  it("translates a known API reason", () => {
    expect(careerFailure(403, { status: 403, value: { error: "AI Apply not available" } })).toBe(
      "Disponível no plano Platinum Premium da sua empresa.",
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
