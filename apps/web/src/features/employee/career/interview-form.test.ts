import { describe, expect, it } from "vitest";
import {
  emptyInterviewDraft,
  interviewInput,
  interviewMode,
  interviewModes,
  interviewProblems,
} from "./interview-form";

const filled = { ...emptyInterviewDraft, date: "2026-12-03", time: "14:30", with: " Ana Souza " };

describe("validates the interview form", () => {
  it("asks for the day, time and person", () => {
    expect(interviewProblems(emptyInterviewDraft)).toEqual({
      date: "Escolha o dia da entrevista.",
      time: "Informe o horário.",
      with: "Informe com quem será a entrevista.",
    });
  });

  it("accepts a complete draft", () => {
    expect(interviewProblems(filled)).toEqual({});
  });

  it("limits the length of the person and notes", () => {
    expect(
      interviewProblems({ ...filled, with: "a".repeat(256), notes: "b".repeat(2001) }),
    ).toEqual({ with: "Use até 255 caracteres.", notes: "Use até 2000 caracteres." });
  });

  it("offers every interview mode", () => {
    expect(interviewModes.map(({ value }) => value)).toEqual(["video", "in_person", "phone"]);
  });
});

describe("builds the interview payload", () => {
  it("sends the time at the Brasília offset and trims text", () => {
    expect(interviewInput({ ...filled, notes: " Leve o portfólio " })).toEqual({
      startsAt: "2026-12-03T14:30:00-03:00",
      mode: "video",
      with: "Ana Souza",
      notes: "Leve o portfólio",
    });
  });
});

describe("reads the interview mode", () => {
  it("keeps a known mode and falls back to video", () => {
    expect(interviewMode("phone")).toBe("phone");
    expect(interviewMode("other")).toBe("video");
  });
});
