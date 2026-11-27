import { describe, expect, it } from "vitest";
import {
  applicationStatus,
  attemptReason,
  attemptState,
  careerDate,
  criterionLabel,
  evidenceValue,
  failedFieldNote,
  isLongText,
  gainLabel,
  jobPlace,
  matchScore,
  pointsLabel,
  resumeScoreState,
  salaryRange,
  scoreCriteria,
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
    expect(attemptReason("form_rejected")).toBe(
      "O site da vaga recusou o envio. Confira as mensagens abaixo.",
    );
    expect(attemptReason("foreign_phone")).toContain("(+55)");
    expect(attemptReason("form_errors")).toContain("a IA não enviou nada");
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

  it("names the field the browser could not fill", () => {
    const evidence = (failedField: string | null) => ({
      fields: [],
      files: [],
      finalUrl: null,
      failedField,
      formErrors: [],
    });

    expect(failedFieldNote({ reason: "form_changed", evidence: evidence("Telefone") })).toBe(
      "O campo “Telefone” não pôde ser preenchido (o formulário da vaga mudou).",
    );
    expect(failedFieldNote({ reason: "fill_failed", evidence: evidence("Telefone") })).toBe(
      "O campo “Telefone” não aceitou a resposta.",
    );
    expect(failedFieldNote({ reason: "upload_failed", evidence: evidence("Currículo") })).toBe(
      "O campo “Currículo” não pôde ser preenchido.",
    );
    expect(failedFieldNote({ reason: "form_changed", evidence: evidence(null) })).toBeNull();
    expect(failedFieldNote({ reason: "form_changed", evidence: null })).toBeNull();
    expect(failedFieldNote({ reason: "error", evidence: evidence("Telefone") })).toBeNull();
  });

  it("labels the score criteria in Portuguese", () => {
    expect(criterionLabel("results")).toBe("Resultados");
    expect(criterionLabel("actionVerbs")).toBe("Verbos de ação");
    expect(criterionLabel("length")).toBe("Tamanho");
    expect(criterionLabel("style")).toBeNull();
    expect(criterionLabel(null)).toBeNull();
  });

  it("lists the known criteria of a breakdown in rubric order", () => {
    expect(
      scoreCriteria({
        length: { points: 5, max: 5, reason: "Tamanho certo." },
        style: { points: 1, max: 1, reason: "Antigo." },
        results: { points: 12, max: 20, reason: "Três números." },
      }),
    ).toEqual([
      { criterion: "results", label: "Resultados", points: 12, max: 20, reason: "Três números." },
      { criterion: "length", label: "Tamanho", points: 5, max: 5, reason: "Tamanho certo." },
    ]);
    expect(scoreCriteria(null)).toEqual([]);
  });

  it("tells a pending, a recalculating and a ready score apart", () => {
    expect(resumeScoreState({ score: null, rescoring: true })).toBe("pending");
    expect(resumeScoreState({ score: null, rescoring: false })).toBe("pending");
    expect(resumeScoreState({ score: 62, rescoring: true })).toBe("recalculating");
    expect(resumeScoreState({ score: 0, rescoring: false })).toBe("ready");
  });

  it("pluralizes points", () => {
    expect(pointsLabel(0)).toBe("0 pontos");
    expect(pointsLabel(1)).toBe("1 ponto");
    expect(pointsLabel(2)).toBe("2 pontos");
    expect(pointsLabel(14)).toBe("14 pontos");
  });

  it("signs gains", () => {
    expect(gainLabel(1)).toBe("+1 ponto");
    expect(gainLabel(2)).toBe("+2 pontos");
    expect(gainLabel(0)).toBe("+0 pontos");
  });
});
