import { createIsomorphicFn } from "@tanstack/react-start";
import { fetchServerApi } from "./api-fetch.server";

export const apiFetch = createIsomorphicFn()
  .server((path: `/api/${string}`, init?: RequestInit) => fetchServerApi(path, init))
  .client((path: `/api/${string}`, init?: RequestInit) =>
    fetch(path, { ...init, cache: "no-store", redirect: "error" }),
  );
