import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "@offboard/db/repositories";
import { seedDatabase } from "@offboard/db/seed-database";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireActions, type ActionContext } from "./actions.ts";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const context: ActionContext = {
  taskId: "task-1",
  taskTitle: "Bloquear acessos",
  status: "done",
  phase: "d0",
};

describe.skipIf(!url)("fireActions", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  let serverUrl = "";
  const receivedRequests: { method: string; url: string; body: string }[] = [];

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      receivedRequests.push({ method: req.method ?? "", url: req.url ?? "", body });

      if (req.url === "/fail") {
        res.writeHead(500);
        res.end("error");

        return;
      }

      if (req.url === "/emails") {
        const parsed = JSON.parse(body);

        if (parsed.to === "fail@example.com") {
          res.writeHead(422);
          res.end(JSON.stringify({ name: "validation_error", message: "Invalid recipient" }));

          return;
        }

        res.writeHead(200);
        res.end(JSON.stringify({ id: "email_123" }));

        return;
      }

      res.writeHead(200);
      res.end("ok");
    });
  });

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        const port = addr && "port" in addr ? addr.port : 0;

        serverUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  beforeEach(async () => {
    await seedDatabase(db);
    receivedRequests.length = 0;
  });

  afterAll(async () => {
    server.close();
    await db.$client.end();
  });

  it("returns empty when phase is empty", async () => {
    const results = await fireActions(repos, { ...context, phase: "" });

    expect(results).toEqual([]);
  });

  it("returns empty when no configs match the phase", async () => {
    const results = await fireActions(repos, { ...context, phase: "nonexistent" });

    expect(results).toEqual([]);
  });

  it("executes a webhook action", async () => {
    await repos.createActionConfig({
      actionId: "webhook:test-exec",
      phase: "d0",
      config: { url: `${serverUrl}/hook`, method: "POST" },
    });

    const results = await fireActions(repos, context);
    const webhookResult = results.find((r) => r.actionId === "webhook:test-exec");

    expect(webhookResult).toEqual({ actionId: "webhook:test-exec", success: true });
    expect(receivedRequests.some((r) => r.url === "/hook")).toBe(true);
  });

  it("reports missing webhook url", async () => {
    await repos.createActionConfig({
      actionId: "webhook:no-url",
      phase: "d0",
      config: {},
    });

    const results = await fireActions(repos, context);
    const result = results.find((r) => r.actionId === "webhook:no-url");

    expect(result).toEqual({ actionId: "webhook:no-url", success: false, error: "missing url" });
  });

  it("reports webhook HTTP failure", async () => {
    await repos.createActionConfig({
      actionId: "webhook:fail-http",
      phase: "d0",
      config: { url: `${serverUrl}/fail`, method: "POST" },
    });

    const results = await fireActions(repos, context);
    const result = results.find((r) => r.actionId === "webhook:fail-http");

    expect(result).toEqual({ actionId: "webhook:fail-http", success: false, error: "HTTP 500" });
  });

  it("executes a slack action with template variables", async () => {
    await repos.createActionConfig({
      actionId: "slack:test-exec",
      phase: "d0",
      config: {
        webhookUrl: `${serverUrl}/slack`,
        message: "{{task}} is now {{status}} in {{phase}}",
      },
    });

    const results = await fireActions(repos, context);
    const slackResult = results.find((r) => r.actionId === "slack:test-exec");

    expect(slackResult).toEqual({ actionId: "slack:test-exec", success: true });

    const slackReq = receivedRequests.find((r) => r.url === "/slack");
    expect(JSON.parse(slackReq!.body)).toEqual({ text: "Bloquear acessos is now done in d0" });
  });

  it("uses default slack message when none configured", async () => {
    await repos.createActionConfig({
      actionId: "slack:default-msg",
      phase: "d0",
      config: { webhookUrl: `${serverUrl}/slack-default` },
    });

    const results = await fireActions(repos, context);
    const result = results.find((r) => r.actionId === "slack:default-msg");

    expect(result).toEqual({ actionId: "slack:default-msg", success: true });

    const slackReq = receivedRequests.find((r) => r.url === "/slack-default");
    expect(JSON.parse(slackReq!.body)).toEqual({
      text: "Task Bloquear acessos changed to done",
    });
  });

  it("reports missing slack webhookUrl", async () => {
    await repos.createActionConfig({
      actionId: "slack:no-url",
      phase: "d0",
      config: {},
    });

    const results = await fireActions(repos, context);
    const result = results.find((r) => r.actionId === "slack:no-url");

    expect(result).toEqual({
      actionId: "slack:no-url",
      success: false,
      error: "missing webhookUrl",
    });
  });

  it("reports slack HTTP failure", async () => {
    await repos.createActionConfig({
      actionId: "slack:fail-http",
      phase: "d0",
      config: { webhookUrl: `${serverUrl}/fail` },
    });

    const results = await fireActions(repos, context);
    const result = results.find((r) => r.actionId === "slack:fail-http");

    expect(result).toEqual({ actionId: "slack:fail-http", success: false, error: "HTTP 500" });
  });

  it("reports missing email recipient", async () => {
    await repos.createActionConfig({
      actionId: "email:no-to",
      phase: "d0",
      config: {},
    });

    const results = await fireActions(repos, context);
    const result = results.find((r) => r.actionId === "email:no-to");

    expect(result).toEqual({ actionId: "email:no-to", success: false, error: "missing to" });
  });

  it("reports missing RESEND_API_KEY", async () => {
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    try {
      await repos.createActionConfig({
        actionId: "email:no-key",
        phase: "d0",
        config: { to: "user@example.com", subject: "Test", body: "Hello" },
      });

      const results = await fireActions(repos, context);
      const result = results.find((r) => r.actionId === "email:no-key");

      expect(result).toEqual({
        actionId: "email:no-key",
        success: false,
        error: "RESEND_API_KEY not configured",
      });
    } finally {
      if (saved !== undefined) {
        process.env.RESEND_API_KEY = saved;
      }
    }
  });

  it("sends email with template variables replaced", async () => {
    process.env.RESEND_API_KEY = "re_test_fake";
    process.env.RESEND_BASE_URL = serverUrl;

    try {
      await repos.createActionConfig({
        actionId: "email:template",
        phase: "d0",
        config: {
          to: "dev@example.com",
          subject: "{{task}} is {{status}}",
          body: "<p>{{task}} moved to {{status}} in {{phase}}</p>",
        },
      });

      const results = await fireActions(repos, context);
      const result = results.find((r) => r.actionId === "email:template");

      expect(result).toEqual({ actionId: "email:template", success: true });

      const emailReq = receivedRequests.find((r) => r.url === "/emails");
      const parsed = JSON.parse(emailReq!.body);

      expect(parsed.from).toBe("Offboard <onboarding@resend.dev>");
      expect(parsed.to).toBe("dev@example.com");
      expect(parsed.subject).toBe("Bloquear acessos is done");
      expect(parsed.html).toBe("<p>Bloquear acessos moved to done in d0</p>");
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.RESEND_BASE_URL;
    }
  });

  it("uses default subject and body when not configured", async () => {
    process.env.RESEND_API_KEY = "re_test_fake";
    process.env.RESEND_BASE_URL = serverUrl;

    try {
      await repos.createActionConfig({
        actionId: "email:defaults",
        phase: "d0",
        config: { to: "dev@example.com" },
      });

      const results = await fireActions(repos, context);
      const result = results.find((r) => r.actionId === "email:defaults");

      expect(result).toEqual({ actionId: "email:defaults", success: true });

      const emailReq = receivedRequests.find((r) => r.url === "/emails");
      const parsed = JSON.parse(emailReq!.body);

      expect(parsed.subject).toBe("Offboard: Bloquear acessos — done");
      expect(parsed.html).toBe(
        "<p>Task <b>Bloquear acessos</b> changed to <b>done</b> in phase <b>d0</b>.</p>",
      );
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.RESEND_BASE_URL;
    }
  });

  it("reports email API error", async () => {
    process.env.RESEND_API_KEY = "re_test_fake";
    process.env.RESEND_BASE_URL = serverUrl;

    try {
      await repos.createActionConfig({
        actionId: "email:api-fail",
        phase: "d0",
        config: { to: "fail@example.com", subject: "Test", body: "Hello" },
      });

      const results = await fireActions(repos, context);
      const result = results.find((r) => r.actionId === "email:api-fail");

      expect(result).toEqual({
        actionId: "email:api-fail",
        success: false,
        error: "Invalid recipient",
      });
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.RESEND_BASE_URL;
    }
  });

  it("reports unknown action types", async () => {
    await repos.createActionConfig({
      actionId: "unknown:thing",
      phase: "d0",
      config: {},
    });

    const results = await fireActions(repos, context);
    const result = results.find((r) => r.actionId === "unknown:thing");

    expect(result).toEqual({
      actionId: "unknown:thing",
      success: false,
      error: "unknown action type",
    });
  });

  it("catches fetch errors for unreachable hosts", async () => {
    await repos.createActionConfig({
      actionId: "webhook:unreachable",
      phase: "d0",
      config: { url: "http://127.0.0.1:1/unreachable" },
    });

    const results = await fireActions(repos, context);
    const result = results.find((r) => r.actionId === "webhook:unreachable");

    expect(result?.success).toBe(false);
    expect(result?.error).toBeDefined();
  });

  it("uses default method for webhook when not specified", async () => {
    await repos.createActionConfig({
      actionId: "webhook:default-method",
      phase: "d0",
      config: { url: `${serverUrl}/default-method` },
    });

    await fireActions(repos, context);

    const req = receivedRequests.find((r) => r.url === "/default-method");
    expect(req?.method).toBe("POST");
  });
});
