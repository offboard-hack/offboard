import { describe, expect, it } from "vitest";
import { parseActions, parseConditions, summarizeActions } from "./rule-form";

describe("rule form", () => {
  it("summarizes actions", () => {
    expect(summarizeActions([])).toBe("Nenhuma ação");
    expect(
      summarizeActions([{ type: "update_task", set: { status: "done" } }, { type: "slack" }]),
    ).toBe("Atualizar tarefa, Enviar Slack");
  });

  it("parses conditions", () => {
    expect(parseConditions("")).toEqual({});
    expect(parseConditions('{"equipment.status":"received"}')).toEqual({
      "equipment.status": "received",
    });
    expect(parseConditions("[]")).toBeNull();
    expect(parseConditions("not json")).toBeNull();
    expect(parseConditions("null")).toBeNull();
  });

  it("parses actions", () => {
    expect(parseActions('[{"type":"slack","channel":"#rh"}]')).toEqual([
      { type: "slack", channel: "#rh" },
    ]);
    expect(parseActions("[]")).toEqual([]);
    expect(parseActions('[{"type":"nope"}]')).toBeNull();
    expect(parseActions('[{"type":"toString"}]')).toBeNull();
    expect(parseActions('[{"type":1}]')).toBeNull();
    expect(parseActions("[1]")).toBeNull();
    expect(parseActions("{}")).toBeNull();
    expect(parseActions("{")).toBeNull();
  });
});
