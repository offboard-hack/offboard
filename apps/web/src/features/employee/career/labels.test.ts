import { describe, expect, it } from "vitest";
import {
  applicationStatus,
  attemptReason,
  attemptState,
  careerDate,
  evidenceValue,
  isLongText,
  jobPlace,
  matchScore,
  salaryRange,
} from "./labels";

const salary = (min: number | null, max: number | null) =>
  salaryRange({ salaryMinCents: min, salaryMaxCents: max })?.replaceAll("\u00a0", " ");

describe("career labels", () => {
  it("formats dates in the Brazil time zone", () => {
    expect(careerDate("2026-11-26T02:00:00.000Z")).toBe("25 de nov. de 2026");
  });

  it("describes where a job happens", () => {
    expect(jobPlace({ workModel: "remote", city: "São Paulo", state: "SP" })).toBe("Remoto");
    expect(jobPlace({ workModel: "hybrid", city: "São Paulo", state: "SP" })).toBe(
      "Híbrido · São Paulo, SP",
    );
    expect(jobPlace({ workModel: "onsite", city: null, state: null })).toBe("Presencial");
    expect(jobPlace({ workModel: null, city: "Recife", state: null })).toBe("Recife");
    expect(jobPlace({ workModel: null, city: null, state: null })).toBe("Local não informado");
  });

  it("formats the salary range", () => {
    expect(salary(800_000, 1_200_000)).toBe("R$ 8.000 – R$ 12.000");
    expect(salary(800_000, 800_000)).toBe("R$ 8.000");
    expect(salary(800_000, null)).toBe("A partir de R$ 8.000");
    expect(salary(null, 800_000)).toBe("Até R$ 8.000");
    expect(salary(null, null)).toBeUndefined();
  });

  it("labels application statuses", () => {
    expect(applicationStatus({ status: "in_review", closedReason: null })).toBe("Em análise");
    expect(applicationStatus({ status: "closed", closedReason: "hired" })).toBe("Contratada");
    expect(applicationStatus({ status: "closed", closedReason: null })).toBe("Encerrada");
  });

  it("labels AI attempts", () => {
    expect(attemptState("rehearsed")).toBe("Ensaio concluído");
    expect(attemptReason("document_required")).toBe(
      "A vaga pede um documento. Candidate-se pelo site da vaga.",
    );
    expect(attemptReason("unknown")).toBeNull();
    expect(attemptReason(null)).toBeNull();
  });

  it("labels the match score", () => {
    expect(matchScore({ score: 82, reasons: [] })).toBe("82% compatível");
    expect(matchScore(null)).toBeNull();
  });

  it("prints evidence values", () => {
    expect(evidenceValue("Marina")).toBe("Marina");
    expect(evidenceValue(["SQL", "CRM"])).toBe("SQL; CRM");
    expect(evidenceValue([])).toBe("Sem resposta");
    expect(evidenceValue("")).toBe("Sem resposta");
    expect(evidenceValue(null)).toBe("Sem resposta");
  });

  it("detects descriptions worth clamping", () => {
    expect(isLongText("Vaga curta.")).toBe(false);
    expect(isLongText("a".repeat(401))).toBe(true);
    expect(isLongText("1\n2\n3\n4\n5\n6\n7")).toBe(true);
  });
});
