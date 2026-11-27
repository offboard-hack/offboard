import { describe, expect, it } from "vitest";
import {
  actionLabels,
  defaultActionsJson,
  parseActions,
  parseConditions,
  summarizeActions,
  triggerItems,
  triggerLabels,
} from "./rule-form";

describe("triggerItems", () => {
  it("lists every trigger with its label", () => {
    expect(triggerItems).toHaveLength(Object.keys(triggerLabels).length);
    expect(triggerItems).toContainEqual({
      value: "schedule.cron",
      label: "Agendamento",
    });
  });
});

describe("summarizeActions", () => {
  it("reports an empty list", () => {
    expect(summarizeActions([])).toBe("Nenhuma ação");
  });

  it("joins action labels", () => {
    expect(summarizeActions([{ type: "slack" }, { type: "email" }])).toBe(
      `${actionLabels.slack}, ${actionLabels.email}`,
    );
  });
});

describe("parseConditions", () => {
  it("treats blank text as no conditions", () => {
    expect(parseConditions("  ")).toEqual({});
  });

  it("parses a string map", () => {
    expect(parseConditions('{"status":"done"}')).toEqual({ status: "done" });
  });

  it("rejects invalid json and non-string values", () => {
    expect(parseConditions("{")).toBeUndefined();
    expect(parseConditions('{"a":1}')).toBeUndefined();
    expect(parseConditions("[]")).toBeUndefined();
  });
});

describe("parseActions", () => {
  it("parses known actions keeping extra fields", () => {
    expect(parseActions('[{"type":"webhook","url":"https://x.test"}]')).toEqual([
      { type: "webhook", url: "https://x.test" },
    ]);
  });

  it("accepts the default template", () => {
    expect(parseActions(defaultActionsJson)).toEqual([{ type: "slack" }]);
  });

  it("rejects blank, invalid json, unknown types and non-arrays", () => {
    expect(parseActions("")).toBeUndefined();
    expect(parseActions("{")).toBeUndefined();
    expect(parseActions('[{"type":"nope"}]')).toBeUndefined();
    expect(parseActions('{"type":"slack"}')).toBeUndefined();
  });
});
