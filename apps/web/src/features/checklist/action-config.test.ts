import { createServer } from "node:http";
import { createServerEntry } from "@tanstack/react-start/server";
import { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ChecklistStep } from "./checklist-draft";
import {
  actionConfigsQuery,
  applyActionConfigs,
  syncActionConfigs as syncConfigs,
  type ActionConfigRow,
} from "./action-config";

type Received = { method: string; url: string; body: unknown };

const received: Received[] = [];
let failing = false;
let listBody: ActionConfigRow[] = [];

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    received.push({ method: req.method ?? "", url: req.url ?? "", body: raw && JSON.parse(raw) });

    if (failing) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unavailable" }));

      return;
    }

    if (req.method === "DELETE") {
      res.writeHead(204);
      res.end();

      return;
    }

    res.writeHead(req.method === "POST" ? 201 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(req.method === "GET" ? listBody : row()));
  });
});

beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = z.object({ port: z.number() }).parse(server.address());
  process.env.API_URL = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
});

beforeEach(() => {
  received.length = 0;
  failing = false;
  listBody = [];
});

function runInRequest<T>(operation: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const entry = createServerEntry({
      async fetch() {
        await operation().then(resolve, reject);

        return new Response(null, { status: 204 });
      },
    });

    void Promise.resolve(entry.fetch(new Request("http://localhost/checklist-automatico"))).catch(
      reject,
    );
  });
}

function syncActionConfigs(...args: Parameters<typeof syncConfigs>) {
  return runInRequest(() => syncConfigs(...args));
}

const email = { subject: "Assunto", body: "Mensagem" };
const slack = { channel: "#rh", message: "Oi" };
const webhook = { url: "https://example.com/hook", method: "POST" as const };

const step = (overrides: Partial<ChecklistStep> = {}) =>
  ({
    id: "s1",
    title: "Etapa",
    team: "RH e DP",
    phase: "d0",
    ...overrides,
  }) satisfies ChecklistStep;

const row = (overrides: Partial<ActionConfigRow> = {}) =>
  ({
    id: "r1",
    actionId: "email:s1",
    enabled: true,
    config: email,
    phase: "d0",
    ...overrides,
  }) satisfies ActionConfigRow;

const byUrl = (a: Received, b: Received) =>
  `${a.method}${a.url}${JSON.stringify(a.body)}`.localeCompare(
    `${b.method}${b.url}${JSON.stringify(b.body)}`,
  );

describe("actionConfigsQuery", () => {
  const fetchRows = () =>
    runInRequest(() => new QueryClient().fetchQuery({ ...actionConfigsQuery, retry: false }));

  it("fetches and parses rows", async () => {
    listBody = [row()];

    expect(await fetchRows()).toEqual([row()]);
    expect(received).toEqual([{ method: "GET", url: "/api/action-configs", body: "" }]);
  });

  it("rejects when the server fails", async () => {
    failing = true;

    await expect(fetchRows()).rejects.toThrow("Failed to fetch action configs");
  });
});

describe("syncActionConfigs", () => {
  it("creates configs missing from existing", async () => {
    await syncActionConfigs([step({ email, slack, webhook })], []);

    expect([...received].sort(byUrl)).toEqual(
      [
        {
          method: "POST",
          url: "/api/action-configs",
          body: { actionId: "email:s1", phase: "d0", enabled: true, config: email },
        },
        {
          method: "POST",
          url: "/api/action-configs",
          body: { actionId: "slack:s1", phase: "d0", enabled: true, config: slack },
        },
        {
          method: "POST",
          url: "/api/action-configs",
          body: { actionId: "webhook:s1", phase: "d0", enabled: true, config: webhook },
        },
      ].sort(byUrl),
    );
  });

  it("updates configs whose phase changed", async () => {
    await syncActionConfigs([step({ phase: "pre", email })], [row()]);

    expect(received).toEqual([
      { method: "PUT", url: "/api/action-configs/r1", body: { phase: "pre", config: email } },
    ]);
  });

  it("updates configs whose values changed", async () => {
    const changed = { ...email, body: "Outra" };

    await syncActionConfigs([step({ email: changed })], [row()]);

    expect(received).toEqual([
      { method: "PUT", url: "/api/action-configs/r1", body: { phase: "d0", config: changed } },
    ]);
  });

  it("deletes configs no longer desired", async () => {
    await syncActionConfigs([step()], [row()]);

    expect(received).toEqual([{ method: "DELETE", url: "/api/action-configs/r1", body: "" }]);
  });

  it("ignores existing rows of unknown kinds", async () => {
    await syncActionConfigs([], [row({ actionId: "other:s1" })]);

    expect(received).toEqual([]);
  });

  it("skips unchanged configs", async () => {
    await syncActionConfigs([step({ email })], [row()]);

    expect(received).toEqual([]);
  });

  it("makes no calls for empty input", async () => {
    await syncActionConfigs([], []);

    expect(received).toEqual([]);
  });

  it("handles create, update and delete together", async () => {
    await syncActionConfigs(
      [
        step({ id: "a", email }),
        step({ id: "b", phase: "pre", slack }),
        step({ id: "c", webhook }),
      ],
      [
        row({ id: "r-a", actionId: "email:a" }),
        row({ id: "r-b", actionId: "slack:b", config: slack }),
        row({ id: "r-gone", actionId: "webhook:gone", config: webhook }),
      ],
    );

    expect([...received].sort(byUrl)).toEqual(
      [
        {
          method: "POST",
          url: "/api/action-configs",
          body: { actionId: "webhook:c", phase: "d0", enabled: true, config: webhook },
        },
        { method: "PUT", url: "/api/action-configs/r-b", body: { phase: "pre", config: slack } },
        { method: "DELETE", url: "/api/action-configs/r-gone", body: "" },
      ].sort(byUrl),
    );
  });

  it("rejects when the server fails", async () => {
    failing = true;

    await expect(syncActionConfigs([step({ email })], [])).rejects.toThrow(
      "Failed to save action config",
    );
  });
});

describe("applyActionConfigs", () => {
  it("merges server email config into a step without one", () => {
    const [result] = applyActionConfigs([step()], [row()]);

    expect(result.email).toEqual(email);
    expect(result.slack).toBeUndefined();
    expect(result.webhook).toBeUndefined();
  });

  it("preserves local config over the server one", () => {
    const local = { subject: "Local", body: "Local" };

    const [result] = applyActionConfigs([step({ email: local })], [row()]);

    expect(result.email).toEqual(local);
  });

  it("ignores invalid server config", () => {
    const [result] = applyActionConfigs([step()], [row({ config: { subject: "" } })]);

    expect(result.email).toBeUndefined();
  });

  it("leaves steps without configs when rows are empty", () => {
    const [result] = applyActionConfigs([step()], []);

    expect(result).toEqual({ ...step(), email: undefined, slack: undefined, webhook: undefined });
  });

  it("handles email, slack and webhook rows", () => {
    const [result] = applyActionConfigs(
      [step()],
      [
        row(),
        row({ id: "r2", actionId: "slack:s1", config: slack }),
        row({ id: "r3", actionId: "webhook:s1", config: webhook }),
      ],
    );

    expect(result).toMatchObject({ email, slack, webhook });
  });
});
