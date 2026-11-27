import type { RuleTrigger } from "@offboard/db/schema";

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

export type FireRules = (trigger: RuleTrigger, context: RuleContext) => Promise<void>;
