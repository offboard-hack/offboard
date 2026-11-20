import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  beneficiaries,
  checklistRules,
  equipment,
  equipmentStatusEnum,
  integrations,
  integrationStatusEnum,
  plans,
  teamMembers,
} from "./index.ts";

const keys = (table: Parameters<typeof getTableColumns>[0]) =>
  Object.keys(getTableColumns(table)).sort();

describe("remaining schemas", () => {
  it("equipment columns", () => {
    expect(keys(equipment)).toEqual(
      ["id", "item", "tag", "person", "method", "scheduledDate", "status"].sort(),
    );
  });

  it("integrations columns", () => {
    expect(keys(integrations)).toEqual(["id", "name", "purpose", "status", "lastActivity"].sort());
  });

  it("beneficiaries columns", () => {
    expect(keys(beneficiaries)).toEqual(["id", "name", "plan", "status", "accessUntil"].sort());
  });

  it("teamMembers columns", () => {
    expect(keys(teamMembers)).toEqual(
      ["id", "name", "role", "accessScope", "securityStatus"].sort(),
    );
  });

  it("plans columns", () => {
    expect(keys(plans)).toEqual(
      ["id", "name", "priceCents", "activeLicenses", "capacity", "costCenter"].sort(),
    );
  });

  it("checklistRules columns", () => {
    expect(keys(checklistRules)).toEqual(
      ["id", "title", "description", "team", "timing", "required", "enabled"].sort(),
    );
  });

  it("enums", () => {
    expect(equipmentStatusEnum.enumValues).toEqual([
      "scheduled",
      "received",
      "failed",
      "inventory",
      "transit",
      "with_person",
    ]);
    expect(integrationStatusEnum.enumValues).toEqual(["connected", "disconnected"]);
  });
});
