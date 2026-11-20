import { describe, expect, it } from "vitest";
import { createClient } from "./client.ts";

describe("createClient", () => {
  it("returns a drizzle instance", () => {
    const db = createClient("postgres://localhost:5432/test");
    expect(db).toBeTruthy();
  });
});
