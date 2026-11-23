import { createServer } from "node:http";
import { createServerEntry } from "@tanstack/react-start/server";
import { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ChecklistStep } from "./checklist-draft";
import {
  actionConfigsQuery,
  applyActionConfigs,
  clearSyncedRemovals,
  knownActionRowIds,
  mergeStepSettings,
  syncActionConfigs as syncConfigs,
  type ActionConfigRow,
} from "./action-config";

type Received = { method: string; url: string; body: unknown };

const received: Received[] = [];
let failing = false;
let failUpdates = false;
let listBody: ActionConfigRow[] = [];

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    received.push({ method: req.method ?? "", url: req.url ?? "", body: raw && JSON.parse(raw) });

    if (failing || (failUpdates && req.method === "PUT")) {
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
  failUpdates = false;
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

function syncActionConfigs(
  steps: ChecklistStep[],
  existing: ActionConfigRow[],
  previousSteps?: ChecklistStep[],
  knownRowIds?: string[],
) {
  return runInRequest(() =>
    syncConfigs(steps, existing, knownRowIds ?? knownActionRowIds(previousSteps ?? [], existing)),
  );
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

  it("deletes configs explicitly removed from a step", async () => {
    await syncActionConfigs([step({ email: null })], [row()], [step({ email })]);

    expect(received).toEqual([{ method: "DELETE", url: "/api/action-configs/r1", body: "" }]);
  });

  it("preserves unrelated server rows and configs the draft has never loaded", async () => {
    await syncActionConfigs(
      [step()],
      [row(), row({ id: "r-unrelated", actionId: "email:another-step" })],
    );

    expect(received).toEqual([]);
  });

  it("ignores existing rows of unknown kinds", async () => {
    await syncActionConfigs([], [row({ actionId: "other:s1" })]);

    expect(received).toEqual([]);
  });

  it("skips unchanged configs", async () => {
    await syncActionConfigs([step({ email })], [row()], [step({ email })]);

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
      [step({ id: "gone", webhook })],
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

  it("preserves newly recreated actions when a draft retries removal", async () => {
    const originalRows = ["r1"];
    const recreatedRows = [row({ id: "r-new" })];

    await syncActionConfigs([step({ email: null })], [row()], [], originalRows);
    await syncActionConfigs([step({ email: null })], recreatedRows, [], originalRows);
    await syncActionConfigs([], recreatedRows, [step({ email })], originalRows);

    expect(received).toEqual([{ method: "DELETE", url: "/api/action-configs/r1", body: "" }]);
  });

  it("reports created rows when another write fails so the draft can remove them", async () => {
    failUpdates = true;
    const updateRow = row({ id: "r2", actionId: "email:update" });

    const result = await syncActionConfigs(
      [step({ email }), step({ id: "update", phase: "pre", email })],
      [updateRow],
    );

    expect(result).toEqual({ createdRowIds: ["r1"], failed: true });
    await syncActionConfigs([], [row()], [], result.createdRowIds);
    expect(received).toContainEqual({ method: "DELETE", url: "/api/action-configs/r1", body: "" });
  });

  it("reports failed writes", async () => {
    failing = true;

    await expect(syncActionConfigs([step({ email })], [])).resolves.toEqual({
      createdRowIds: [],
      failed: true,
    });
  });
});

describe("mergeStepSettings", () => {
  it("distinguishes a title edit from removing a configured action", async () => {
    const settings = {
      title: "Nome atualizado",
      deadlineOffset: null,
      rules: [],
      email: null,
      slack: null,
      webhook: null,
    };

    const configured = step({ email });
    const removal = mergeStepSettings(configured, settings);
    const cleared = clearSyncedRemovals([removal]);
    const renamed = mergeStepSettings(cleared[0], settings);

    expect(removal.email).toBeNull();
    expect(renamed.email).toBeUndefined();
    expect(mergeStepSettings(step(), { ...settings, email }).email).toEqual(email);

    await syncActionConfigs([removal], [row()], [configured]);
    await syncActionConfigs([renamed], [row()]);

    expect(received).toEqual([{ method: "DELETE", url: "/api/action-configs/r1", body: "" }]);
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

  it("preserves explicit draft removals across all action types", () => {
    const rows = [
      row(),
      row({ id: "r2", actionId: "slack:s1", config: slack }),
      row({ id: "r3", actionId: "webhook:s1", config: webhook }),
    ];

    const draft = [step({ email: null, slack: null, webhook: null })];

    expect(applyActionConfigs(draft, rows)[0]).toMatchObject({
      email: null,
      slack: null,
      webhook: null,
    });
    expect(applyActionConfigs(clearSyncedRemovals(draft), rows)[0]).toMatchObject({
      email,
      slack,
      webhook,
    });
    expect(clearSyncedRemovals([step({ email, slack, webhook })])[0]).toMatchObject({
      email,
      slack,
      webhook,
    });
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
