import { htmlToText } from "./html-text.js";
import { discardBody, readCapped } from "./response-body.js";

export type FetchPageResult =
  | { url: URL; text: string }
  | "invalid_url"
  | "unreachable"
  | "not_html"
  | "too_large";

const maxRedirects = 3;
const maxBytes = 2_000_000;
const blockedSuffixes = [".localhost", ".local", ".internal"];
const ipv4Literal = /^\d+\.\d+\.\d+\.\d+$/;

const isPublicHostname = (hostname: string) => {
  const host = hostname.replace(/\.$/, "");

  return (
    host.includes(".") &&
    !hostname.includes("..") &&
    !host.startsWith("[") &&
    !ipv4Literal.test(host) &&
    !blockedSuffixes.some((suffix) => host.endsWith(suffix))
  );
};

export const parsePublicUrl = (raw: string) => {
  const invalid = "invalid_url" as const;

  if (!URL.canParse(raw)) return invalid;

  const url = new URL(raw);

  const allowed =
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    isPublicHostname(url.hostname);

  return allowed ? url : invalid;
};

const readPage = async (url: URL, response: Response) => {
  if (!response.ok) {
    await discardBody(response);

    return "unreachable" satisfies FetchPageResult;
  }

  const mediaType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

  if (mediaType !== "text/html") {
    await discardBody(response);

    return "not_html" satisfies FetchPageResult;
  }

  if (Number(response.headers.get("content-length")) > maxBytes) {
    await discardBody(response);

    return "too_large" satisfies FetchPageResult;
  }

  if (response.body === null) return { url, text: "" } satisfies FetchPageResult;

  const html = await readCapped(response.body, maxBytes);

  if (html === null) return "too_large" satisfies FetchPageResult;

  return { url, text: htmlToText(html) } satisfies FetchPageResult;
};

const nextLocation = (response: Response, current: URL) => {
  const location = response.headers.get("location");

  if (location === null) return "unreachable" satisfies FetchPageResult;

  if (!URL.canParse(location, current)) return "invalid_url" satisfies FetchPageResult;

  return parsePublicUrl(new URL(location, current).href);
};

export const fetchPageText = async (url: URL, fetchImpl: typeof fetch = fetch) => {
  const signal = AbortSignal.timeout(10_000);
  let current = parsePublicUrl(url.href);

  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (current === "invalid_url") return current;

      const response = await fetchImpl(current, { redirect: "manual", signal });

      if (response.status < 300 || response.status >= 400) return await readPage(current, response);

      await discardBody(response);

      const next = nextLocation(response, current);

      if (next === "unreachable") return next;

      current = next;
    }
  } catch {
    return "unreachable" satisfies FetchPageResult;
  }

  return "unreachable" satisfies FetchPageResult;
};
