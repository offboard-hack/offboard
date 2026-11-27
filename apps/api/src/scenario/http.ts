export type Send = (request: Request) => Promise<Response>;

export type Reply = { status: number; body: unknown; cookies: string[] };

type CallOptions = {
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  headers?: Record<string, string>;
};

function parseBody(text: string) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createHttp(send: Send, apiOrigin: string, webOrigin: string) {
  return async function call(method: string, path: string, options: CallOptions = {}) {
    const headers = new Headers({ origin: webOrigin, ...options.headers });

    const body =
      options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));

    if (body !== undefined) headers.set("content-type", "application/json");

    if (options.cookie) headers.set("cookie", options.cookie);

    const response = await send(new Request(`${apiOrigin}/api${path}`, { method, headers, body }));

    return {
      status: response.status,
      body: parseBody(await response.text()),
      cookies: response.headers.getSetCookie(),
    } satisfies Reply;
  };
}

export type Http = ReturnType<typeof createHttp>;
