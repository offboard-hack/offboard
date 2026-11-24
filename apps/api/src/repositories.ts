import type { Database } from "@offboard/db/client";
import { createOffboardingsRepository } from "./features/offboardings/repository.js";
import { createIntegrationsRepository } from "./features/integrations/repository.js";
import { createActionConfigsRepository } from "./features/action-configs/repository.js";
import { createAutomationRulesRepository } from "./features/automation-rules/repository.js";
import { createBillingRepository } from "./features/billing/repository.js";
import { createEquipmentRepository } from "./features/equipment/repository.js";
import { createExitSurveysRepository } from "./features/exit-surveys/repository.js";
import { createTeamRepository } from "./features/team/repository.js";

export function createRepositories(db: Database) {
  return {
    offboardings: createOffboardingsRepository(db),
    integrations: createIntegrationsRepository(db),
    actionConfigs: createActionConfigsRepository(db),
    automationRules: createAutomationRulesRepository(db),
    team: createTeamRepository(db),
    equipment: createEquipmentRepository(db),
    exitSurveys: createExitSurveysRepository(db),
    billing: createBillingRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
