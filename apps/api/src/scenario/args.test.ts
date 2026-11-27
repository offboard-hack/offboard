import { expect, it } from "vitest";
import { assertLocalTargets, isLoopbackHost, parseArgs } from "./args.js";

it("parses the scenario name and applies defaults", () => {
  expect(parseArgs(["orgs"])).toEqual({
    name: "orgs",
    baseUrl: "http://127.0.0.1:3001",
    webOrigin: "http://localhost:5173",
    allowRemote: false,
  });
});

it("reads the API and web origins from options", () => {
  expect(
    parseArgs([
      "career",
      "--base-url",
      "http://127.0.0.1:4000/api",
      "--web-origin",
      "http://localhost:5174/",
    ]),
  ).toEqual({
    name: "career",
    baseUrl: "http://127.0.0.1:4000",
    webOrigin: "http://localhost:5174",
    allowRemote: false,
  });
});

it("rejects unknown scenarios, extra names and options without a value", () => {
  expect(() => parseArgs([])).toThrow("Usage: npm run scenario");
  expect(() => parseArgs(["nope"])).toThrow("Usage: npm run scenario");
  expect(() => parseArgs(["orgs", "career"])).toThrow("Usage: npm run scenario");
  expect(() => parseArgs(["orgs", "--base-url"])).toThrow("Missing value for --base-url");
  expect(() => parseArgs(["orgs", "--base-url", "--web-origin", "x"])).toThrow(
    "Missing value for --base-url",
  );
  expect(() => parseArgs(["orgs", "--base-url", "not a url"])).toThrow();
});

it("accepts --allow-remote without a value", () => {
  expect(parseArgs(["orgs", "--allow-remote"]).allowRemote).toBe(true);
  expect(parseArgs(["--allow-remote", "orgs"]).allowRemote).toBe(true);
});

it("lists --web-origin in the usage", () => {
  expect(() => parseArgs([])).toThrow("--web-origin");
});

it("recognizes loopback hosts only", () => {
  for (const host of ["127.0.0.1", "localhost", "::1", "[::1]", ""]) {
    expect(isLoopbackHost(host)).toBe(true);
  }

  for (const host of ["db.example.com", "10.0.0.5", "127.0.0.1.example.com", "0.0.0.0"]) {
    expect(isLoopbackHost(host)).toBe(false);
  }
});

it("refuses remote API and database targets unless allowed", () => {
  const local = { baseUrl: "http://127.0.0.1:3001", databaseUrl: "postgres://u@localhost:5432/d" };

  expect(() => assertLocalTargets({ ...local, allowRemote: false })).not.toThrow();
  expect(() =>
    assertLocalTargets({ ...local, baseUrl: "https://api.example.com", allowRemote: false }),
  ).toThrow("--allow-remote");
  expect(() =>
    assertLocalTargets({
      ...local,
      databaseUrl: "postgres://u@db.example.com/d",
      allowRemote: false,
    }),
  ).toThrow("--allow-remote");
  expect(() =>
    assertLocalTargets({
      ...local,
      databaseUrl: "postgres://u@db.example.com/d",
      allowRemote: true,
    }),
  ).not.toThrow();
  expect(() =>
    assertLocalTargets({ ...local, databaseUrl: "not a url", allowRemote: false }),
  ).toThrow("DATABASE_URL");
});
