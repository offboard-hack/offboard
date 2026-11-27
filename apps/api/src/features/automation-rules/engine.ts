import type {
  ConfigValue,
  RuleAction,
  RuleTrigger,
  automationRules,
  equipment,
  tasks,
} from "@offboard/db/schema";
import { Resend } from "resend";
import { z } from "zod";
import { postSlackMessage } from "../../shared/slack.js";

export type RuleContext = {
  orgId: string;
  task?: {
    id: string;
    title: string;
    status: string;
    previousStatus?: string;
    phase?: string;
    stepId?: string;
  };
  equipment?: {
    id: string;
    tag?: string;
    item?: string;
    status: string;
    previousStatus?: string;
  };
  case?: { id: string; name: string };
};

export type RuleResult = { ruleId: string; matched: boolean; errors: string[] };

export type Rule = Pick<
  typeof automationRules.$inferSelect,
  "id" | "name" | "trigger" | "conditions" | "actions"
>;

export type EngineRepos = {
  automationRules: {
    getEnabledRulesByTrigger: (orgId: string, trigger: RuleTrigger) => Promise<Rule[]>;
    getAllCronRules: () => Promise<(Rule & { orgId: string })[]>;
  };
  offboardings: {
    updateTaskStatus: (
      orgId: string,
      id: string,
      status: (typeof tasks.$inferSelect)["status"],
    ) => Promise<{ id: string } | null>;
  };
  equipment: {
    updateEquipmentStatus: (
      orgId: string,
      id: string,
      status: (typeof equipment.$inferSelect)["status"],
    ) => Promise<{ id: string } | null>;
    areAllCaseEquipmentReceived: (orgId: string, caseId: string) => Promise<boolean>;
  };
  runCorreiosCheck?: (orgId: string) => Promise<void>;
  slack: {
    apiUrl: string;
    readToken: (orgId: string) => Promise<string | undefined>;
  };
  emailEnabled: (orgId: string) => Promise<boolean>;
};

export const MAX_CHAIN_DEPTH = 3;

const taskStatus = z.enum(["todo", "in_progress", "done"]);

const equipmentStatus = z.enum([
  "with_person",
  "scheduled",
  "transit",
  "received",
  "inventory",
  "failed",
]);

const updateTaskAction = z.object({ set: z.object({ status: taskStatus }) });

const updateEquipmentAction = z.object({ set: z.object({ status: equipmentStatus }) });

const nonEmpty = z.string().min(1);

function succeed(context?: RuleContext) {
  return { error: undefined, context };
}

function fail(error: string | undefined) {
  return { error, context: undefined };
}

function text(value: ConfigValue | undefined) {
  const parsed = nonEmpty.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}

function flatten(context: RuleContext) {
  const values = new Map<string, string | undefined>();

  for (const group of ["task", "equipment", "case"] as const) {
    for (const [key, value] of Object.entries(context[group] ?? {})) {
      values.set(`${group}.${key}`, value);
    }
  }

  return values;
}

export function renderTemplate(template: string, context: RuleContext) {
  const values = flatten(context);

  const aliases = new Map([
    ["tag", context.equipment?.tag],
    ["item", context.equipment?.item],
    ["task", context.task?.title],
    ["status", context.equipment?.status ?? context.task?.status],
    ["case", context.case?.name],
  ]);

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const value = aliases.has(key) ? aliases.get(key) : values.get(key);

    return value ?? match;
  });
}

export async function matchesConditions(
  conditions: Rule["conditions"],
  context: RuleContext,
  repos: EngineRepos,
) {
  const values = flatten(context);

  for (const [path, expected] of Object.entries(conditions)) {
    const actual =
      path === "case.allEquipmentReceived"
        ? String(
            context.case !== undefined &&
              (await repos.equipment.areAllCaseEquipmentReceived(context.orgId, context.case.id)),
          )
        : values.get(path);

    if (actual !== expected) return false;
  }

  return true;
}

async function updateTask(
  action: RuleAction,
  context: RuleContext,
  repos: EngineRepos,
  depth: number,
) {
  const parsed = updateTaskAction.safeParse(action);

  if (!parsed.success) return fail("update_task requires set.status");

  if (!context.task) return fail("update_task requires a task in context");

  const { status } = parsed.data.set;

  if (context.task.status === status) return succeed();

  if (!(await repos.offboardings.updateTaskStatus(context.orgId, context.task.id, status))) {
    return fail("task not found");
  }

  const next = {
    ...context,
    task: { ...context.task, previousStatus: context.task.status, status },
  };

  await fireRulesForTrigger("task.status_changed", next, repos, depth + 1);

  return succeed(next);
}

async function updateEquipment(
  action: RuleAction,
  context: RuleContext,
  repos: EngineRepos,
  depth: number,
) {
  const parsed = updateEquipmentAction.safeParse(action);

  if (!parsed.success) return fail("update_equipment requires set.status");

  if (!context.equipment) return fail("update_equipment requires equipment in context");

  const { status } = parsed.data.set;

  if (context.equipment.status === status) return succeed();

  if (!(await repos.equipment.updateEquipmentStatus(context.orgId, context.equipment.id, status))) {
    return fail("equipment not found");
  }

  const next = {
    ...context,
    equipment: { ...context.equipment, previousStatus: context.equipment.status, status },
  };

  await fireRulesForTrigger("equipment.status_changed", next, repos, depth + 1);

  return succeed(next);
}

async function sendSlack(action: RuleAction, context: RuleContext, repos: EngineRepos) {
  const message = text(action.message);

  if (!message) return fail("slack requires message");

  const rendered = renderTemplate(message, context);
  const webhookUrl = text(action.webhookUrl);

  if (webhookUrl) {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: rendered }),
      signal: AbortSignal.timeout(10_000),
    });

    return response.ok ? succeed() : fail(`HTTP ${response.status}`);
  }

  const token = text(action.botToken) ?? (await repos.slack.readToken(context.orgId));
  const channel = text(action.channel);

  if (!token || !channel) return fail("slack requires webhookUrl or botToken and channel");

  const sent = await postSlackMessage(repos.slack.apiUrl, token, channel, rendered);

  return sent.ok ? succeed() : fail(sent.error);
}

async function sendEmail(action: RuleAction, context: RuleContext, repos: EngineRepos) {
  if (!(await repos.emailEnabled(context.orgId))) return fail("E-mail disabled");

  const to = text(action.to);

  if (!to) return fail("email requires to");

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) return fail("RESEND_API_KEY not configured");

  const { error } = await new Resend(apiKey).emails.send(
    {
      from: "Offboard <onboarding@resend.dev>",
      to,
      subject: renderTemplate(text(action.subject) ?? "Offboard", context),
      html: renderTemplate(text(action.body) ?? "", context),
    },
    { signal: AbortSignal.timeout(10_000) },
  );

  return error ? fail(error.message) : succeed();
}

async function callWebhook(action: RuleAction, context: RuleContext) {
  const url = text(action.url);

  if (!url) return fail("webhook requires url");

  const response = await fetch(url, {
    method: text(action.method) ?? "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...context, orgId: undefined }),
    signal: AbortSignal.timeout(10_000),
  });

  return response.ok ? succeed() : fail(`HTTP ${response.status}`);
}

async function runCorreiosCheck(context: RuleContext, repos: EngineRepos) {
  if (!repos.runCorreiosCheck) return fail("correios_check is not available");

  await repos.runCorreiosCheck(context.orgId);

  return succeed();
}

async function runAction(
  action: RuleAction,
  context: RuleContext,
  repos: EngineRepos,
  depth: number,
) {
  switch (action.type) {
    case "update_task":
      return updateTask(action, context, repos, depth);
    case "update_equipment":
      return updateEquipment(action, context, repos, depth);
    case "slack":
      return sendSlack(action, context, repos);
    case "email":
      return sendEmail(action, context, repos);
    case "webhook":
      return callWebhook(action, context);
    case "correios_check":
      return runCorreiosCheck(context, repos);
    default:
      return fail(`unknown action type ${String(action.type)}`);
  }
}

export async function executeRule(rule: Rule, context: RuleContext, repos: EngineRepos, depth = 0) {
  const errors: string[] = [];
  let matched = false;

  try {
    matched = await matchesConditions(rule.conditions, context, repos);

    let current = context;

    for (const action of matched ? rule.actions : []) {
      try {
        const outcome = await runAction(action, current, repos, depth);

        if (outcome.error) errors.push(`${action.type}: ${outcome.error}`);

        current = outcome.context ?? current;
      } catch (error) {
        errors.push(`${action.type}: ${String(error)}`);
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  return { ruleId: rule.id, matched, errors } satisfies RuleResult;
}

export async function fireRulesForTrigger(
  trigger: RuleTrigger,
  context: RuleContext,
  repos: EngineRepos,
  depth = 0,
) {
  if (depth >= MAX_CHAIN_DEPTH) return [];

  let rules: Rule[];

  try {
    rules = await repos.automationRules.getEnabledRulesByTrigger(context.orgId, trigger);
  } catch {
    return [];
  }

  const results: RuleResult[] = [];

  for (const rule of rules) {
    results.push(await executeRule(rule, context, repos, depth));
  }

  return results;
}

export async function runScheduledRules(repos: EngineRepos) {
  const rules = await repos.automationRules.getAllCronRules();
  const results: RuleResult[] = [];

  for (const { orgId, ...rule } of rules) {
    results.push(await executeRule(rule, { orgId }, repos));
  }

  return results;
}
