import { expect, it } from "vitest";
import { createClient } from "../client.ts";
import { createRepositories } from "./index.ts";

it("wires all repositories", () => {
  const repos = createRepositories(createClient("postgres://localhost/unused"));
  expect(Object.keys(repos).sort()).toEqual([
    "access",
    "billing",
    "checklist",
    "equipment",
    "integrations",
    "offboardings",
    "tasks",
  ]);
});
