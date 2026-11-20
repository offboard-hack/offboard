import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { offboardingCases, tasks, taskStatusEnum } from "./offboarding.ts";

describe("offboardingCases schema", () => {
  it("has the expected columns", () => {
    const cols = getTableColumns(offboardingCases);
    expect(Object.keys(cols).sort()).toEqual(
      ["id", "name", "role", "department", "deadline", "createdAt", "updatedAt"].sort(),
    );
  });
});

describe("tasks schema", () => {
  it("has the expected columns", () => {
    const cols = getTableColumns(tasks);
    expect(Object.keys(cols).sort()).toEqual(
      ["id", "caseId", "title", "team", "status", "position", "createdAt", "updatedAt"].sort(),
    );
  });

  it("cascades deletes from offboardingCases via caseId", () => {
    const [fk] = getTableConfig(tasks).foreignKeys;
    const ref = fk!.reference();
    expect(ref.columns[0]!.name).toBe("case_id");
    expect(ref.foreignColumns[0]!.name).toBe("id");
    expect(ref.foreignTable).toBe(offboardingCases);
    expect(fk!.onDelete).toBe("cascade");
  });

  it("indexes caseId", () => {
    const [idx] = getTableConfig(tasks).indexes;
    expect(idx!.config.columns.map((c) => ("name" in c ? c.name : null))).toEqual(["case_id"]);
  });

  it("status enum has three values", () => {
    expect(taskStatusEnum.enumValues).toEqual(["done", "in_progress", "todo"]);
  });
});
