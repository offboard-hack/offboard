import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";

export function fetchServerApi(path: `/api/${string}`, init?: RequestInit) {
  const deploymentHost = process.env.VERCEL_URL;
  const deploymentOrigin = deploymentHost ? `https://${deploymentHost}` : undefined;

  const origin =
    process.env.API_URL ??
    (deploymentOrigin && (process.env.BETTER_AUTH_URL ?? deploymentOrigin)) ??
    "http://localhost:3001";

  const url = new URL(path, origin);
  const headers = new Headers(init?.headers);
  const cookie = getRequestHeader("cookie");
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  if (cookie) headers.set("cookie", cookie);

  if (bypass && url.origin === deploymentOrigin) {
    headers.set("x-vercel-protection-bypass", bypass);
  }

  setResponseHeader("Cache-Control", "private, no-store");

  return fetch(url, { ...init, headers, cache: "no-store", redirect: "error" });
}
