import { expect, it } from "vitest";
import { parseArgs } from "./args.js";

it("parses the scenario name and applies defaults", () => {
  expect(parseArgs(["orgs"])).toEqual({
    name: "orgs",
    baseUrl: "http://127.0.0.1:3001",
    webOrigin: "http://localhost:5173",
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
