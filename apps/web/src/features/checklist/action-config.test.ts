import { createServer } from "node:http";
import { createServerEntry } from "@tanstack/react-start/server";
import { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ChecklistStep } from "./checklist-draft";
import {
  actionConfigsQuery,
  checklistActionConfigsQuery,
  applyActionConfigs,
  mergeStepSettings,
  knownActionRowIds,
  type ActionConfigRow,
} from "./action-config";

type Received = { method: string; url: string; body: unknown };

const received: Received[] = [];
let failing = false;

interface ServerRule {
  id: string;
  sourceRef: string | null;
  name: string;
  trigger: string;
  conditions: Record<string, string>;
  actions: { type: string; [k: string]: string }[] | string;
  enabled: boolean;
  cronSchedule: string | null;
  createdAt: string;
  updatedAt: string;
}

let listBody: ServerRule[] | null = [];

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

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(listBody));
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
    config: email,
    ...overrides,
  }) satisfies ActionConfigRow;

function apiRule(r: ActionConfigRow) {
  return {
    id: r.id,
    sourceRef: r.actionId,
    name: r.actionId,
    trigger: "task.status_changed",
    conditions: {},
    actions: [{ type: r.actionId.split(":")[0], ...r.config }],
    enabled: true,
    cronSchedule: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("actionConfigsQuery", () => {
  const fetchRows = () =>
    runInRequest(() => new QueryClient().fetchQuery({ ...actionConfigsQuery, retry: false }));

  it("fetches and parses rows", async () => {
    listBody = [apiRule(row())];

    expect(await fetchRows()).toEqual([row()]);
    expect(received).toEqual([{ method: "GET", url: "/api/automation-rules", body: "" }]);
  });

  it("returns empty when API returns null-ish data", async () => {
    listBody = null;

    expect(await fetchRows()).toEqual([]);
  });

  it("skips rules without sourceRef and handles missing actions", async () => {
    listBody = [
      apiRule(row()),
      { ...apiRule(row({ id: "r2" })), sourceRef: null, actions: [] },
      { ...apiRule(row({ id: "r3", actionId: "email:s3" })), actions: "not-an-array" },
      { ...apiRule(row({ id: "r4", actionId: "email:s4" })), actions: [] },
    ];

    const result = await fetchRows();

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(row());
    expect(result[1]).toEqual({ id: "r3", actionId: "email:s3", config: {} });
    expect(result[2]).toEqual({ id: "r4", actionId: "email:s4", config: {} });
  });

  it("rejects when the server fails", async () => {
    failing = true;

    await expect(fetchRows()).rejects.toThrow("Failed to fetch action configs");
  });
});

it("scopes the checklist action cache to the organization", () => {
  expect(checklistActionConfigsQuery("org-a").queryKey).not.toEqual(
    checklistActionConfigsQuery("org-b").queryKey,
  );
});

it("tracks only rows for steps loaded in the draft", () => {
  expect(
    knownActionRowIds(
      [step()],
      [
        row(),
        row({ id: "r2", actionId: "email:other-step" }),
        row({ id: "r3", actionId: "webhook:s1" }),
      ],
    ),
  ).toEqual(["r1", "r3"]);
});

describe("mergeStepSettings", () => {
  it("distinguishes a title edit from removing a configured action", () => {
    const settings = {
      title: "Nome atualizado",
      deadlineOffset: null,
      deadlineTime: null,
      rules: [],
      email: null,
      slack: null,
      webhook: null,
    };

    const configured = step({ email });
    const removal = mergeStepSettings(configured, settings);
    const renamed = mergeStepSettings(step(), settings);

    expect(removal.email).toBeNull();
    expect(renamed.email).toBeUndefined();
    expect(mergeStepSettings(step(), { ...settings, email }).email).toEqual(email);
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
