import type { RuleTrigger } from "@offboard/db/schema";

export type RuleContext = {
  equipment?: {
    id: string;
    tag: string;
    item: string;
    status: string;
    previousStatus?: string;
    caseId: string;
    taskId?: string;
  };
  task?: {
    id: string;
    title: string;
    status: string;
    previousStatus?: string;
    caseId: string;
  };
  case?: { id: string; name: string };
};

export type RuleResult = { ruleId: string; matched: boolean; errors: string[] };

export type FireRules = (trigger: RuleTrigger, context: RuleContext) => Promise<RuleResult[]>;
