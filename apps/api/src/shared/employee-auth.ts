import type { PortalAuth } from "./portal-auth.js";

export type EmployeePrincipal = {
  id: string;
  caseId: string;
  grantId: string;
  name: string;
  email: string;
};

export type EmployeeAuth = NonNullable<PortalAuth["resolveEmployee"]>;

const appOrigin = "offboard://";

export function isEmployeeApp(request: Request, webOrigin: string) {
  if (request.headers.has("origin")) return false;

  const nativeOrigin = request.headers.get("expo-origin");

  if (nativeOrigin === appOrigin || nativeOrigin === `${appOrigin}/`) return true;

  const host = new URL(webOrigin).hostname;

  return (
    ["localhost", "127.0.0.1", "[::1]"].includes(host) &&
    /^exp:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2):\d+(?:\/--)?\/?$/.test(nativeOrigin ?? "")
  );
}
