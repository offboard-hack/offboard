import { describe, expect, it } from "vitest";
import { routeForHost } from "./backoffice-host";

const backoffice = "https://backoffice.off-board.xyz";

const route = (url: string, method = "GET", origin: string | undefined = backoffice) =>
  routeForHost({ url, method }, origin);

describe("routeForHost", () => {
  it("leaves every other host to the portal", () => {
    expect(route("https://app.off-board.xyz/")).toBe("portal");
    expect(route("https://app.off-board.xyz/api/auth/sign-out", "POST")).toBe("portal");
    expect(routeForHost({ url: "http://localhost:3000/", method: "GET" })).toBe("portal");
  });

  it("allows only the auth and backoffice APIs on the backoffice host", () => {
    expect(route(`${backoffice}/api/auth/sign-out`, "POST")).toBe("api");
    expect(route(`${backoffice}/api/backoffice/summary`)).toBe("api");
    expect(route(`${backoffice}/api/backoffice`)).toBe("api");
    expect(route(`${backoffice}/api/cases`)).toBe("not-found");
    expect(route(`${backoffice}/api/authx/x`)).toBe("not-found");
  });

  it("serves the backoffice app for page requests and rejects the rest", () => {
    expect(route(`${backoffice}/`)).toBe("backoffice");
    expect(route(`${backoffice}/anything`, "HEAD")).toBe("backoffice");
    expect(route(`${backoffice}/`, "POST")).toBe("not-found");
  });
});
