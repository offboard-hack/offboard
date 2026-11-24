export type FetchPageResult =
  | { url: URL; text: string }
  | "invalid_url"
  | "unreachable"
  | "not_html"
  | "too_large";

const maxRedirects = 3;
const maxBytes = 2_000_000;
const maxChars = 30_000;
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

const htmlToText = (html: string) =>
  html
    .replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, " ")
    .replace(/<[^>]*(?:>|$)/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);

const readCapped = async (body: ReadableStream<Uint8Array>) => {
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;

  const reader = body.getReader();

  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.byteLength;

    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);

      return null;
    }

    parts.push(decoder.decode(next.value, { stream: true }));
  }

  parts.push(decoder.decode());

  return parts.join("");
};

const discard = async (response: Response) => {
  await response.body?.cancel().catch(() => undefined);
};

const readPage = async (url: URL, response: Response) => {
  if (!response.ok) {
    await discard(response);

    return "unreachable" satisfies FetchPageResult;
  }

  const mediaType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

  if (mediaType !== "text/html") {
    await discard(response);

    return "not_html" satisfies FetchPageResult;
  }

  if (Number(response.headers.get("content-length")) > maxBytes) {
    await discard(response);

    return "too_large" satisfies FetchPageResult;
  }

  if (response.body === null) return { url, text: "" } satisfies FetchPageResult;

  const html = await readCapped(response.body);

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

      await discard(response);

      const next = nextLocation(response, current);

      if (next === "unreachable") return next;

      current = next;
    }
  } catch {
    return "unreachable" satisfies FetchPageResult;
  }

  return "unreachable" satisfies FetchPageResult;
};
