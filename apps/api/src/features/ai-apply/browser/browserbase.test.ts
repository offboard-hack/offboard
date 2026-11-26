import { describe, expect, it, vi } from "vitest";
import { BrowserbaseError, createBrowserbase } from "./browserbase.js";

const config = { apiKey: "bb-secret-key", projectId: "proj-1" };

const fetching = (...responses: Response[]) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });

    const next = responses.shift();

    if (next === undefined) throw new Error("unexpected fetch");

    return next;
  };

  return { calls, fetchImpl };
};

const json = (body: Record<string, string | number>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("createBrowserbase", () => {
  it("creates a session with the configured settings", async () => {
    const { calls, fetchImpl } = fetching(
      json({ id: "s1", connectUrl: "wss://connect/s1", extra: 1 }),
    );

    const session = await createBrowserbase(fetchImpl, config).createSession();

    expect(session).toEqual({ id: "s1", connectUrl: "wss://connect/s1" });
    expect(calls[0]?.url).toBe("https://api.browserbase.com/v1/sessions");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(calls[0]?.init?.headers).get("x-bb-api-key")).toBe("bb-secret-key");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      projectId: "proj-1",
      region: "us-east-1",
      timeout: 240,
      browserSettings: {
        recordSession: false,
        logSession: false,
        solveCaptchas: true,
      },
    });
  });

  it("throws a BrowserbaseError with the status when creation is refused", async () => {
    const { fetchImpl } = fetching(json({ message: "limit" }, 429));

    const error = await createBrowserbase(fetchImpl, config)
      .createSession()
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(BrowserbaseError);
    expect(error.status).toBe(429);
    expect(error.message).not.toContain("bb-secret-key");
  });

  it("throws when the session payload is malformed", async () => {
    const { fetchImpl } = fetching(json({ id: "s1" }));

    await expect(createBrowserbase(fetchImpl, config).createSession()).rejects.toThrow(
      BrowserbaseError,
    );
  });

  it("uploads a file as multipart", async () => {
    const { calls, fetchImpl } = fetching(json({ message: "ok" }));

    await createBrowserbase(fetchImpl, config).upload("s1", {
      name: "curriculo.pdf",
      bytes: new Uint8Array([1, 2, 3]),
      type: "application/pdf",
    });

    expect(calls[0]?.url).toBe("https://api.browserbase.com/v1/sessions/s1/uploads");
    expect(new Headers(calls[0]?.init?.headers).get("x-bb-api-key")).toBe("bb-secret-key");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    const body = calls[0]?.init?.body;
    expect(body).toBeInstanceOf(FormData);
    const file = body instanceof FormData ? body.get("file") : null;
    expect(file).toBeInstanceOf(File);
    expect(file instanceof File ? file.name : "").toBe("curriculo.pdf");
    expect(file instanceof File ? file.type : "").toBe("application/pdf");
  });

  it("throws when the upload is refused", async () => {
    const { fetchImpl } = fetching(json({}, 402));

    const error = await createBrowserbase(fetchImpl, config)
      .upload("s1", {
        name: "a.pdf",
        bytes: new Uint8Array(),
        type: "application/pdf",
      })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(BrowserbaseError);
    expect(error.status).toBe(402);
  });

  it("releases a session", async () => {
    const { calls, fetchImpl } = fetching(json({}));

    await createBrowserbase(fetchImpl, config).release("s1");

    expect(calls[0]?.url).toBe("https://api.browserbase.com/v1/sessions/s1");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      projectId: "proj-1",
      status: "REQUEST_RELEASE",
    });
  });

  it("reads the live view without the navbar", async () => {
    const { calls, fetchImpl } = fetching(
      json({
        debuggerFullscreenUrl:
          "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=x",
        debuggerUrl: "https://www.browserbase.com/devtools/inspector.html?wss=x",
        wsUrl: "wss://connect/s1",
      }),
      json({ debuggerFullscreenUrl: "https://www.browserbase.com/live/s1" }),
    );

    const browserbase = createBrowserbase(fetchImpl, config);

    expect(await browserbase.liveUrl("s1")).toBe(
      "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=x&navbar=false",
    );
    expect(await browserbase.liveUrl("s1")).toBe(
      "https://www.browserbase.com/live/s1?navbar=false",
    );
    expect(calls[0]?.url).toBe("https://api.browserbase.com/v1/sessions/s1/debug");
    expect(calls[0]?.init?.method).toBeUndefined();
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(calls[0]?.init?.headers).get("x-bb-api-key")).toBe("bb-secret-key");
  });

  it("gives up on the live view after ten seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    const { fetchImpl } = fetching(
      json({ debuggerFullscreenUrl: "https://www.browserbase.com/l" }),
    );

    await createBrowserbase(fetchImpl, config).liveUrl("s1");

    expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000);
    timeout.mockRestore();
  });

  it("throws without the payload when the live view is refused or malformed", async () => {
    const leaked = "https://www.browserbase.com/devtools-fullscreen/secret";

    const { fetchImpl } = fetching(
      json({ message: leaked }, 404),
      json({ debuggerFullscreenUrl: 7 }),
      json({ debuggerFullscreenUrl: "javascript:alert(1)" }),
    );

    const browserbase = createBrowserbase(fetchImpl, config);

    for (const status of [404, 200, 200]) {
      const error = await browserbase.liveUrl("s1").catch((caught) => caught);

      expect(error).toBeInstanceOf(BrowserbaseError);
      expect(error.status).toBe(status);
      expect(error.message).not.toContain(leaked);
    }
  });

  it("throws when the release is refused", async () => {
    const { fetchImpl } = fetching(json({}, 500));

    await expect(createBrowserbase(fetchImpl, config).release("s1")).rejects.toThrow(
      BrowserbaseError,
    );
  });
});
