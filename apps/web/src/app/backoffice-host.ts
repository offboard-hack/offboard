const apiPrefixes = ["/api/auth/", "/api/backoffice/"];

export const backofficeIndexPath = "/backoffice/";

export function routeForHost(request: { url: string; method: string }, backofficeOrigin?: string) {
  const url = new URL(request.url);

  if (!backofficeOrigin || url.host !== new URL(backofficeOrigin).host) return "portal" as const;

  if (apiPrefixes.some((prefix) => `${url.pathname}/`.startsWith(prefix))) return "api" as const;

  if (url.pathname.startsWith("/api/")) return "not-found" as const;

  return request.method === "GET" || request.method === "HEAD"
    ? ("backoffice" as const)
    : ("not-found" as const);
}
