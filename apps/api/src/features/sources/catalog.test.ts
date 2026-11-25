import { expect, it } from "vitest";
import { catalogSources } from "./catalog.js";

it("lists the reviewed boards with Brazilian jobs", () => {
  expect(catalogSources).toEqual([
    { kind: "greenhouse", target: "stone", label: "Stone" },
    { kind: "greenhouse", target: "quintoandar", label: "QuintoAndar" },
  ]);
});

it("keeps every catalog entry unique and storable", () => {
  const keys = catalogSources.map((source) => `${source.kind}:${source.target}`);

  expect(new Set(keys).size).toBe(keys.length);

  for (const source of catalogSources) {
    expect(source.target).toMatch(/^[a-z0-9][a-z0-9_-]{0,99}$/);
    expect(source.label === null || source.label.length <= 255).toBe(true);
  }
});
