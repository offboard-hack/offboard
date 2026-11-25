import { z } from "zod";

export class CdpError extends Error {
  readonly method: string | undefined;

  constructor(message: string, method?: string) {
    super(method === undefined ? message : `${method}: ${message}`);
    this.name = "CdpError";
    this.method = method;
  }
}

export class CdpTimeoutError extends CdpError {
  constructor(method: string, timeoutMs: number) {
    super(`timed out after ${timeoutMs}ms`, method);
    this.name = "CdpTimeoutError";
  }
}

export type Socket = {
  send(data: string): void;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
  close(): void;
};

export type Page = {
  navigate(url: string): Promise<void>;
  evaluate<T>(expression: string, schema: z.ZodType<T>): Promise<T>;
  waitFor(expression: string, timeoutMs: number): Promise<boolean>;
  click(selector: string): Promise<void>;
  type(text: string): Promise<void>;
  press(key: "Enter" | "ArrowDown" | "Tab" | "Escape"): Promise<void>;
  setFiles(selector: string, paths: string[]): Promise<void>;
  screenshot(options?: { fullPage?: boolean }): Promise<Uint8Array>;
  url(): Promise<string>;
  close(): void;
};

export type WorkerWebSocket = {
  accept(): void;
  send(data: string): void;
  close(): void;
  addEventListener(type: "message", listener: (event: { data: string }) => void): void;
  addEventListener(type: "close", listener: () => void): void;
};

type UpgradeResponse = Response & { webSocket?: WorkerWebSocket | null };

export const workerSocket = async (
  fetchImpl: (input: string, init: RequestInit) => Promise<UpgradeResponse>,
  url: string,
) => {
  const response = await fetchImpl(url.replace(/^wss:/, "https:"), {
    headers: { Upgrade: "websocket" },
  });

  const webSocket = response.webSocket;

  if (!webSocket) throw new CdpError("no websocket");

  webSocket.accept();

  return {
    send: (data) => webSocket.send(data),
    onMessage: (listener) => webSocket.addEventListener("message", (event) => listener(event.data)),
    onClose: (listener) => webSocket.addEventListener("close", listener),
    close: () => webSocket.close(),
  } satisfies Socket;
};

const message = z.object({
  id: z.number().optional(),
  result: z.json().optional(),
  error: z.object({ message: z.string() }).optional(),
});

const targets = z.object({
  targetInfos: z.array(z.object({ targetId: z.string(), type: z.string() })),
});

const attached = z.object({ sessionId: z.string() });

const navigated = z.object({ errorText: z.string().optional() });

const evaluation = z.object({
  result: z.object({ value: z.unknown().optional(), objectId: z.string().optional() }).optional(),
  exceptionDetails: z
    .object({
      text: z.string(),
      exception: z.object({ description: z.string().optional() }).optional(),
    })
    .optional(),
});

const box = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .nullable();

const screenshot = z.object({ data: z.string() });

const layout = z.object({ cssContentSize: z.object({ width: z.number(), height: z.number() }) });

const keys = {
  Enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  Tab: { code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
};

const pollMs = 250;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Params = Record<string, string | number | boolean | string[] | Record<string, number>>;

type Pending = {
  resolve(value: z.core.util.JSONType | undefined): void;
  reject(error: CdpError): void;
};

export const connectPage = async (socket: Socket, options: { commandTimeoutMs?: number } = {}) => {
  const commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let closed = false;

  const failAll = () => {
    closed = true;

    for (const entry of pending.values()) entry.reject(new CdpError("socket closed"));

    pending.clear();
  };

  socket.onMessage((data) => {
    let raw: unknown;

    try {
      raw = JSON.parse(data);
    } catch {
      return;
    }

    const parsed = message.safeParse(raw);

    if (!parsed.success || parsed.data.id === undefined) return;

    const entry = pending.get(parsed.data.id);

    if (entry === undefined) return;

    pending.delete(parsed.data.id);

    if (parsed.data.error) entry.reject(new CdpError(parsed.data.error.message));
    else entry.resolve(parsed.data.result);
  });
  socket.onClose(failAll);

  const send = <T>(
    method: string,
    params: Params,
    schema: z.ZodType<T>,
    sessionId?: string,
    timeoutMs = commandTimeoutMs,
  ) =>
    new Promise<T>((resolve, reject) => {
      if (closed) return reject(new CdpError("socket closed", method));

      nextId += 1;
      const id = nextId;

      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new CdpTimeoutError(method, timeoutMs));
      }, timeoutMs);

      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);

          const parsed = schema.safeParse(value);

          if (parsed.success) resolve(parsed.data);
          else reject(new CdpError("unexpected response", method));
        },
        reject(error) {
          clearTimeout(timer);
          reject(new CdpError(error.message, method));
        },
      });

      const request = { id, method, params, sessionId };

      socket.send(JSON.stringify(request));
    });

  const { targetInfos } = await send("Target.getTargets", {}, targets);
  const target = targetInfos.find((info) => info.type === "page");

  if (target === undefined) throw new CdpError("no page target", "Target.getTargets");

  const { sessionId } = await send(
    "Target.attachToTarget",
    { targetId: target.targetId, flatten: true },
    attached,
  );

  const command = <T>(method: string, params: Params, schema: z.ZodType<T>, timeoutMs?: number) =>
    send(method, params, schema, sessionId, timeoutMs);

  await command("Page.enable", {}, z.unknown());
  await command("DOM.enable", {}, z.unknown());

  const runtime = async (expression: string, byValue: boolean, timeoutMs?: number) => {
    const response = await command(
      "Runtime.evaluate",
      byValue ? { expression, returnByValue: true, awaitPromise: true } : { expression },
      evaluation,
      timeoutMs,
    );

    if (response.exceptionDetails) {
      const { text, exception } = response.exceptionDetails;

      throw new CdpError(exception?.description ?? text, "Runtime.evaluate");
    }

    return response.result;
  };

  const evaluateWithin = async <T>(
    expression: string,
    valueSchema: z.ZodType<T>,
    timeoutMs?: number,
  ) => {
    const result = await runtime(expression, true, timeoutMs);
    const parsed = valueSchema.safeParse(result?.value);

    if (!parsed.success) throw new CdpError("unexpected value", "Runtime.evaluate");

    return parsed.data;
  };

  const evaluate = <T>(expression: string, valueSchema: z.ZodType<T>) =>
    evaluateWithin(expression, valueSchema);

  const mouse = (type: "mousePressed" | "mouseReleased", x: number, y: number) =>
    command("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, z.unknown());

  const page = {
    async navigate(url) {
      const { errorText } = await command("Page.navigate", { url }, navigated);

      if (errorText) throw new CdpError(errorText, "Page.navigate");
    },

    evaluate,

    async waitFor(expression, timeoutMs) {
      const deadline = Date.now() + timeoutMs;

      for (;;) {
        const remaining = deadline - Date.now();

        const truthy = await evaluateWithin(
          expression,
          z.unknown(),
          Math.max(1, Math.min(remaining, commandTimeoutMs)),
        ).catch((error) => {
          if (closed) throw error;

          return false;
        });

        if (truthy) return true;

        if (Date.now() + pollMs > deadline) return false;

        await sleep(pollMs);
      }
    },

    async click(selector) {
      const target = JSON.stringify(selector);

      const center = await evaluate(
        `(() => { const el = document.querySelector(${target}); if (!el) return null; el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height }; })()`,
        box,
      );

      if (center === null) throw new CdpError(`not found: ${selector}`);

      if (center.width <= 0 || center.height <= 0) {
        throw new CdpError(`not visible: ${selector}`);
      }

      await mouse("mousePressed", center.x, center.y);
      await mouse("mouseReleased", center.x, center.y);
    },

    async type(text) {
      await command("Input.insertText", { text }, z.unknown());
    },

    async press(key) {
      const details = { key, ...keys[key] };

      await command("Input.dispatchKeyEvent", { type: "keyDown", ...details }, z.unknown());
      await command("Input.dispatchKeyEvent", { type: "keyUp", ...details }, z.unknown());
    },

    async setFiles(selector, paths) {
      const result = await runtime(`document.querySelector(${JSON.stringify(selector)})`, false);

      if (result?.objectId === undefined) throw new CdpError(`not found: ${selector}`);

      await command(
        "DOM.setFileInputFiles",
        { objectId: result.objectId, files: paths },
        z.unknown(),
      );
    },

    async screenshot(options = {}) {
      const clip = async () => {
        const { cssContentSize } = await command("Page.getLayoutMetrics", {}, layout);
        const width = Math.ceil(cssContentSize.width);
        const height = Math.ceil(cssContentSize.height);

        return { x: 0, y: 0, width, height, scale: 1 };
      };

      const capture = (params: Params) =>
        command("Page.captureScreenshot", { format: "png", ...params }, screenshot);

      const { data } = options.fullPage
        ? await capture({ captureBeyondViewport: true, clip: await clip() })
        : await capture({});

      return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    },

    url: () => evaluate("location.href", z.string()),

    close() {
      failAll();
      socket.close();
    },
  } satisfies Page;

  return page;
};

export const openPage = async (
  fetchImpl: (input: string, init: RequestInit) => Promise<UpgradeResponse>,
  url: string,
) => connectPage(await workerSocket(fetchImpl, url));
