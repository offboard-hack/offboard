import { createApiClient } from "@offboard/api-client";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";

export function createServerApiClient() {
  const deploymentHost = process.env.VERCEL_URL;
  const deploymentOrigin = deploymentHost ? `https://${deploymentHost}` : undefined;

  const origin =
    process.env.API_URL ??
    (deploymentOrigin && (process.env.BETTER_AUTH_URL ?? deploymentOrigin)) ??
    "http://localhost:3001";

  const headers = new Headers();
  const cookie = getRequestHeader("cookie");
  const requestOrigin = getRequestHeader("origin");
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  if (cookie) headers.set("cookie", cookie);

  if (requestOrigin) headers.set("origin", requestOrigin);

  if (bypass && new URL(origin).origin === deploymentOrigin) {
    headers.set("x-vercel-protection-bypass", bypass);
  }

  setResponseHeader("Cache-Control", "private, no-store");

  return createApiClient(origin, {
    headers,
    parseDate: false,
    fetch: { cache: "no-store", redirect: "error" },
  });
}
