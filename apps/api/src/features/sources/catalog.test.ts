import { expect, it } from "vitest";
import { catalogSources } from "./catalog.js";

it("keeps the original boards and a broad list of reviewed ones", () => {
  expect(catalogSources).toContainEqual({ kind: "greenhouse", target: "stone", label: "Stone" });
  expect(catalogSources).toContainEqual({
    kind: "greenhouse",
    target: "quintoandar",
    label: "QuintoAndar",
  });
  expect(catalogSources.length).toBeGreaterThanOrEqual(40);
});

it("lists boards sorted by company", () => {
  const labels = catalogSources.map((source) => source.label ?? source.target);
  const sorted = [...labels].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  expect(labels).toEqual(sorted);
});

it("keeps every catalog entry unique and storable", () => {
  const keys = catalogSources.map((source) => `${source.kind}:${source.target}`);

  expect(new Set(keys).size).toBe(keys.length);

  for (const source of catalogSources) {
    expect(source.target).toMatch(/^[a-z0-9][a-z0-9_-]{0,99}$/);
    expect(source.label === null || source.label.length <= 255).toBe(true);
  }
});
