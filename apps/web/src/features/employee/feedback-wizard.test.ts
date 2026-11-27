import { describe, expect, it } from "vitest";
import {
  feedbackStepIssues,
  feedbackStepRatings,
  feedbackSteps,
  feedbackWizardDefaults,
  toDepartureFeedback,
} from "./feedback-wizard";

const answered = {
  ...feedbackWizardDefaults,
  recommendation: 8,
  assessment: 4 as const,
  managerSupport: 5 as const,
  teamRespect: 4 as const,
  communication: 3 as const,
  equipmentReturn: 4 as const,
  documents: 5 as const,
};

describe("exit survey wizard", () => {
  it("has a rating question for each answer on its page", () => {
    expect(feedbackStepRatings).toHaveLength(feedbackSteps.length);
    expect(feedbackStepRatings.flat().map(({ key }) => key)).toEqual([
      "assessment",
      "managerSupport",
      "teamRespect",
      "communication",
      "equipmentReturn",
      "documents",
    ]);
  });

  it("names every unanswered question on the current page only", () => {
    expect(feedbackStepIssues(0, feedbackWizardDefaults)).toEqual({
      recommendation: "Escolha uma nota de 0 a 10.",
      assessment: "Escolha uma nota.",
    });
    expect(feedbackStepIssues(1, { ...feedbackWizardDefaults, managerSupport: 3 })).toEqual({
      teamRespect: "Escolha uma nota.",
    });
    expect(Object.keys(feedbackStepIssues(2, feedbackWizardDefaults))).toEqual([
      "communication",
      "equipmentReturn",
      "documents",
    ]);
    expect(feedbackStepIssues(3, feedbackWizardDefaults)).toEqual({});
  });

  it("accepts a complete page and limits the comment", () => {
    expect(feedbackStepIssues(0, answered)).toEqual({});
    expect(feedbackStepIssues(3, { ...answered, comment: "a".repeat(801) })).toEqual({
      comment: "Use até 800 caracteres.",
    });
  });

  it("builds the stored feedback with the legacy answers left empty", () => {
    expect(
      toDepartureFeedback({ ...answered, topics: ["Clareza de prazos"], comment: " ok " }),
    ).toEqual({
      anonymous: true,
      clarity: null,
      respect: null,
      recommendation: 8,
      assessment: 4,
      managerSupport: 5,
      teamRespect: 4,
      communication: 3,
      equipmentReturn: 4,
      documents: 5,
      topics: ["Clareza de prazos"],
      comment: "ok",
    });
    expect(() => toDepartureFeedback(feedbackWizardDefaults)).toThrow();
  });
});
