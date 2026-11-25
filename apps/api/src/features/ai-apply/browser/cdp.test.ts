import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CdpError,
  CdpTimeoutError,
  connectPage,
  openPage,
  workerSocket,
  type Socket,
  type WorkerWebSocket,
} from "./cdp.js";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type Command = { id: number; method: string; params: Record<string, Json>; sessionId?: string };

type Reply = Record<string, Json> | "silent";

const defaults = new Map<string, Reply>([
  [
    "Target.getTargets",
    {
      targetInfos: [
        { targetId: "worker", type: "service_worker" },
        { targetId: "t1", type: "page" },
        { targetId: "t2", type: "page" },
      ],
    },
  ],
  ["Target.attachToTarget", { sessionId: "sess" }],
]);

const fakeSocket = (script: Record<string, Reply | Reply[]> = {}) => {
  const commands: Command[] = [];
  let message: (data: string) => void = () => {};
  let closed: () => void = () => {};
  let closeCalls = 0;

  const socket: Socket = {
    send(data) {
      const parsed = JSON.parse(data);

      const command: Command = {
        id: parsed.id,
        method: parsed.method,
        params: parsed.params,
        sessionId: parsed.sessionId,
      };

      commands.push(command);

      const entry = script[command.method] ?? defaults.get(command.method) ?? {};
      const reply = Array.isArray(entry) ? (entry.length > 1 ? entry.shift() : entry[0]) : entry;

      if (reply === "silent") return;

      queueMicrotask(() => {
        message(JSON.stringify({ method: "Page.loadEventFired", params: {} }));
        message("not json");
        message(JSON.stringify({ id: 9999, result: {} }));

        if (reply !== undefined && "error" in reply) {
          message(
            JSON.stringify({ id: command.id, error: { code: -32000, message: reply.error } }),
          );
        } else {
          message(JSON.stringify({ id: command.id, result: reply }));
        }
      });
    },
    onMessage(listener) {
      message = listener;
    },
    onClose(listener) {
      closed = listener;
    },
    close() {
      closeCalls += 1;
    },
  };

  return {
    socket,
    commands,
    drop: () => closed(),
    closeCalls: () => closeCalls,
    named: (method: string) => commands.filter((command) => command.method === method),
  };
};

const evaluated = (value: Json) => ({ result: { type: "x", value } });

describe("connectPage", () => {
  it("attaches to the first page target with flatten and enables domains", async () => {
    const fake = fakeSocket();

    await connectPage(fake.socket);

    expect(fake.commands.map((command) => command.method)).toEqual([
      "Target.getTargets",
      "Target.attachToTarget",
      "Page.enable",
      "DOM.enable",
    ]);
    expect(fake.commands[1]?.params).toEqual({ targetId: "t1", flatten: true });
    expect(fake.commands[2]?.sessionId).toBe("sess");
    expect(fake.commands[3]?.sessionId).toBe("sess");
  });

  it("fails when there is no page target", async () => {
    const fake = fakeSocket({
      "Target.getTargets": { targetInfos: [{ targetId: "w", type: "worker" }] },
    });

    await expect(connectPage(fake.socket)).rejects.toThrow(CdpError);
  });

  it("fails when the response shape is unexpected", async () => {
    const fake = fakeSocket({ "Target.getTargets": { nope: true } });

    await expect(connectPage(fake.socket)).rejects.toThrow(CdpError);
  });

  it("throws with the method name on a CDP error", async () => {
    const fake = fakeSocket({ "Page.navigate": { error: "Cannot navigate" } });
    const page = await connectPage(fake.socket);

    const error = await page.navigate("https://x.test").catch((caught) => caught);

    expect(error).toBeInstanceOf(CdpError);
    expect(error.message).toContain("Page.navigate");
    expect(error.message).toContain("Cannot navigate");
    expect(error.method).toBe("Page.navigate");
  });

  it("times out a silent command", async () => {
    const fake = fakeSocket({ "Page.navigate": "silent" });
    const page = await connectPage(fake.socket, { commandTimeoutMs: 20 });

    const error = await page.navigate("https://x.test").catch((caught) => caught);

    expect(error).toBeInstanceOf(CdpTimeoutError);
    expect(error).toBeInstanceOf(CdpError);
    expect(error.message).toContain("Page.navigate");
  });

  it("uses a 30 second default timeout without firing early", async () => {
    const fake = fakeSocket();
    const page = await connectPage(fake.socket);

    await expect(page.navigate("https://x.test")).resolves.toBeUndefined();
  });

  it("rejects pending commands when the socket drops and later ones immediately", async () => {
    const fake = fakeSocket({ "Page.navigate": "silent" });
    const page = await connectPage(fake.socket);

    const pending = page.navigate("https://x.test");
    fake.drop();

    await expect(pending).rejects.toThrow("socket closed");
    await expect(page.url()).rejects.toThrow("socket closed");
  });

  it("closes the socket and rejects pending commands on close", async () => {
    const fake = fakeSocket({ "Page.navigate": "silent" });
    const page = await connectPage(fake.socket);

    const pending = page.navigate("https://x.test");
    page.close();

    await expect(pending).rejects.toBeInstanceOf(CdpError);
    expect(fake.closeCalls()).toBe(1);
  });

  it("navigates and surfaces navigation failures", async () => {
    const fake = fakeSocket({
      "Page.navigate": [{ frameId: "f" }, { errorText: "net::ERR_NAME_NOT_RESOLVED" }],
    });

    const page = await connectPage(fake.socket);

    await page.navigate("https://x.test");
    await expect(page.navigate("https://bad.test")).rejects.toThrow("net::ERR_NAME_NOT_RESOLVED");

    expect(fake.named("Page.navigate")[0]?.params).toEqual({
      url: "https://x.test",
    });
    expect(fake.named("Page.navigate")[0]?.sessionId).toBe("sess");
  });

  it("evaluates and parses the value", async () => {
    const fake = fakeSocket({ "Runtime.evaluate": evaluated({ n: 2 }) });
    const page = await connectPage(fake.socket);

    const value = await page.evaluate("1+1", z.object({ n: z.number() }));

    expect(value).toEqual({ n: 2 });
    expect(fake.named("Runtime.evaluate")[0]?.params).toMatchObject({
      expression: "1+1",
      returnByValue: true,
      awaitPromise: true,
    });
  });

  it("throws when the value does not match the schema", async () => {
    const fake = fakeSocket({ "Runtime.evaluate": evaluated("text") });
    const page = await connectPage(fake.socket);

    await expect(page.evaluate("x", z.number())).rejects.toThrow(CdpError);
  });

  it("throws on exception details", async () => {
    const fake = fakeSocket({
      "Runtime.evaluate": [
        {
          exceptionDetails: {
            text: "Uncaught",
            exception: { description: "ReferenceError: x" },
          },
        },
        { exceptionDetails: { text: "Uncaught" } },
      ],
    });

    const page = await connectPage(fake.socket);

    await expect(page.evaluate("x", z.string())).rejects.toThrow("ReferenceError: x");
    await expect(page.evaluate("x", z.string())).rejects.toThrow("Uncaught");
  });

  it("waits until the expression is truthy", async () => {
    const fake = fakeSocket({
      "Runtime.evaluate": [evaluated(false), evaluated(true)],
    });

    const page = await connectPage(fake.socket);

    await expect(page.waitFor("ready", 2000)).resolves.toBe(true);
    expect(fake.named("Runtime.evaluate")).toHaveLength(2);
  });

  it("returns false on timeout, tolerating evaluation errors", async () => {
    const fake = fakeSocket({
      "Runtime.evaluate": [{ exceptionDetails: { text: "navigating" } }, evaluated(0)],
    });

    const page = await connectPage(fake.socket);

    await expect(page.waitFor("ready", 300)).resolves.toBe(false);
  });

  it("stops waiting when the socket closes", async () => {
    const fake = fakeSocket({ "Runtime.evaluate": "silent" });
    const page = await connectPage(fake.socket);

    const waiting = page.waitFor("ready", 5000);
    fake.drop();

    await expect(waiting).rejects.toThrow("socket closed");
  });

  it("does not overrun the timeout when an evaluation hangs", async () => {
    const fake = fakeSocket({ "Runtime.evaluate": "silent" });
    const page = await connectPage(fake.socket);
    const started = Date.now();

    await expect(page.waitFor("ready", 100)).resolves.toBe(false);

    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("refuses to click an element without a box", async () => {
    const fake = fakeSocket({
      "Runtime.evaluate": evaluated({ x: 1, y: 1, width: 0, height: 10 }),
    });

    const page = await connectPage(fake.socket);

    await expect(page.click("#hidden")).rejects.toThrow("not visible: #hidden");
    expect(fake.named("Input.dispatchMouseEvent")).toHaveLength(0);
  });

  it("refuses to click an element with zero height", async () => {
    const fake = fakeSocket({
      "Runtime.evaluate": evaluated({ x: 1, y: 1, width: 10, height: 0 }),
    });

    const page = await connectPage(fake.socket);

    await expect(page.click("#flat")).rejects.toThrow("not visible: #flat");
  });

  it("clicks the center of the element box", async () => {
    const fake = fakeSocket({
      "Runtime.evaluate": evaluated({ x: 110, y: 55, width: 20, height: 10 }),
    });

    const page = await connectPage(fake.socket);

    await page.click("button[type=submit]");

    expect(String(fake.named("Runtime.evaluate")[0]?.params.expression)).toContain(
      '"button[type=submit]"',
    );
    const mouse = fake.named("Input.dispatchMouseEvent");
    expect(mouse.map((command) => command.params)).toEqual([
      { type: "mousePressed", x: 110, y: 55, button: "left", clickCount: 1 },
      { type: "mouseReleased", x: 110, y: 55, button: "left", clickCount: 1 },
    ]);
  });

  it("fails to click a missing element", async () => {
    const fake = fakeSocket({ "Runtime.evaluate": evaluated(null) });
    const page = await connectPage(fake.socket);

    await expect(page.click("#gone")).rejects.toThrow("not found: #gone");
    expect(fake.named("Input.dispatchMouseEvent")).toHaveLength(0);
  });

  it("types text", async () => {
    const fake = fakeSocket();
    const page = await connectPage(fake.socket);

    await page.type("Hello");

    expect(fake.named("Input.insertText")[0]?.params).toEqual({
      text: "Hello",
    });
  });

  it("presses keys with codes", async () => {
    const fake = fakeSocket();
    const page = await connectPage(fake.socket);

    await page.press("Enter");
    await page.press("ArrowDown");
    await page.press("Tab");
    await page.press("Escape");

    const keys = fake.named("Input.dispatchKeyEvent").map((command) => command.params);
    expect(keys).toHaveLength(8);
    expect(keys[0]).toMatchObject({
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    expect(keys[1]).toMatchObject({
      type: "keyUp",
      key: "Enter",
      windowsVirtualKeyCode: 13,
    });
    expect(keys[2]).toMatchObject({
      type: "keyDown",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    expect(keys[4]).toMatchObject({
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    expect(keys[6]).toMatchObject({
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
  });

  it("sets files through the element objectId", async () => {
    const fake = fakeSocket({
      "Runtime.evaluate": { result: { type: "object", objectId: "obj-1" } },
    });

    const page = await connectPage(fake.socket);

    await page.setFiles("#resume", ["/tmp/.uploads/curriculo.pdf"]);

    expect(fake.named("Runtime.evaluate")[0]?.params.returnByValue).toBeUndefined();
    expect(fake.named("DOM.setFileInputFiles")[0]?.params).toEqual({
      objectId: "obj-1",
      files: ["/tmp/.uploads/curriculo.pdf"],
    });
  });

  it("fails to set files on a missing element", async () => {
    const fake = fakeSocket({
      "Runtime.evaluate": {
        result: { type: "object", subtype: "null", value: null },
      },
    });

    const page = await connectPage(fake.socket);

    await expect(page.setFiles("#nope", ["/x"])).rejects.toThrow("not found: #nope");
  });

  it("captures a PNG screenshot", async () => {
    const fake = fakeSocket({
      "Page.captureScreenshot": { data: btoa("\u0089PNG") },
    });

    const page = await connectPage(fake.socket);

    const bytes = await page.screenshot();

    expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(fake.named("Page.captureScreenshot")[0]?.params).toEqual({
      format: "png",
    });
  });

  it("captures the whole page beyond the viewport", async () => {
    const fake = fakeSocket({
      "Page.getLayoutMetrics": { cssContentSize: { x: 0, y: 0, width: 1280.4, height: 3012.2 } },
      "Page.captureScreenshot": { data: btoa("\u0089PNG") },
    });

    const page = await connectPage(fake.socket);

    const bytes = await page.screenshot({ fullPage: true });

    expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(fake.named("Page.getLayoutMetrics")).toHaveLength(1);
    expect(fake.named("Page.captureScreenshot")[0]?.params).toEqual({
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1281, height: 3013, scale: 1 },
    });
  });

  it("reads the current url", async () => {
    const fake = fakeSocket({
      "Runtime.evaluate": evaluated("https://x.test/a"),
    });

    const page = await connectPage(fake.socket);

    await expect(page.url()).resolves.toBe("https://x.test/a");
    expect(fake.named("Runtime.evaluate")[0]?.params.expression).toBe("location.href");
  });
});

const fakeWorkerWebSocket = () => {
  const listeners: ((event: { data: string }) => void)[] = [];
  const sent: string[] = [];
  let accepted = 0;
  let closed = 0;

  const webSocket = {
    accept() {
      accepted += 1;
    },
    send(data: string) {
      sent.push(data);
    },
    close() {
      closed += 1;
    },
    addEventListener(_type: "message" | "close", listener: (event: { data: string }) => void) {
      listeners.push(listener);
    },
  } satisfies WorkerWebSocket;

  return {
    webSocket,
    message: (data: string) => listeners[0]?.({ data }),
    close: () => listeners[1]?.({ data: "" }),
    sent,
    accepted: () => accepted,
    closed: () => closed,
  };
};

describe("workerSocket", () => {
  const upgrade = (webSocket: WorkerWebSocket | null) => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];

    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });

      return Object.assign(new Response("", { status: 200 }), { webSocket });
    };

    return { calls, fetchImpl };
  };

  it("upgrades over https and bridges messages", async () => {
    const fake = fakeWorkerWebSocket();
    const { calls, fetchImpl } = upgrade(fake.webSocket);

    const socket = await workerSocket(fetchImpl, "wss://connect.test/s1?x=1");
    const received: string[] = [];
    let closes = 0;
    socket.onMessage((data) => received.push(data));
    socket.onClose(() => {
      closes += 1;
    });
    socket.send("ping");
    fake.message("pong");
    fake.close();
    socket.close();

    expect(calls[0]?.url).toBe("https://connect.test/s1?x=1");
    expect(new Headers(calls[0]?.init?.headers).get("upgrade")).toBe("websocket");
    expect(fake.accepted()).toBe(1);
    expect(fake.sent).toEqual(["ping"]);
    expect(received).toEqual(["pong"]);
    expect(closes).toBe(1);
    expect(fake.closed()).toBe(1);
  });

  it("fails without a websocket", async () => {
    const { fetchImpl } = upgrade(null);

    await expect(workerSocket(fetchImpl, "wss://connect.test/s1")).rejects.toThrow("no websocket");
  });

  it("fails when the response carries no websocket property", async () => {
    const fetchImpl = async () => new Response("", { status: 200 });

    await expect(workerSocket(fetchImpl, "wss://connect.test/s1")).rejects.toThrow(CdpError);
  });
});

describe("openPage", () => {
  it("connects a page over the upgraded websocket", async () => {
    const fake = fakeWorkerWebSocket();
    const urls: string[] = [];

    const replies = new Map<string, Json>([
      ["Target.getTargets", { targetInfos: [{ targetId: "t1", type: "page" }] }],
      ["Target.attachToTarget", { sessionId: "sess" }],
      ["Runtime.evaluate", evaluated("https://x.test/form")],
    ]);

    fake.webSocket.send = (data: string) => {
      const { id, method } = JSON.parse(data);

      queueMicrotask(() => fake.message(JSON.stringify({ id, result: replies.get(method) ?? {} })));
    };

    const fetchImpl = async (input: string | URL | Request) => {
      urls.push(String(input));

      return Object.assign(new Response("", { status: 200 }), { webSocket: fake.webSocket });
    };

    const page = await openPage(fetchImpl, "wss://connect.test/s1");

    await expect(page.url()).resolves.toBe("https://x.test/form");
    expect(urls).toEqual(["https://connect.test/s1"]);
    expect(fake.accepted()).toBe(1);
  });
});
