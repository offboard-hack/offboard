import type { Database } from "@offboard/db/client";
import { createOffboardingsRepository } from "./features/offboardings/repository.js";
import { createIntegrationsRepository } from "./features/integrations/repository.js";
import { createActionConfigsRepository } from "./features/action-configs/repository.js";
import { createBillingRepository } from "./features/billing/repository.js";
import { createEquipmentRepository } from "./features/equipment/repository.js";
import { createExitSurveysRepository } from "./features/exit-surveys/repository.js";
import { createTeamRepository } from "./features/team/repository.js";
import { createTalentRepository } from "./features/talent/repository.js";
import { createJobsRepository } from "./features/jobs/repository.js";
import { createApplicationsRepository } from "./features/applications/repository.js";
import { createResumesRepository } from "./features/resumes/repository.js";
import { createSuggestionsRepository } from "./features/resumes/suggestions.js";
import { createUsageRepository } from "./features/resumes/usage.js";
import { createAccountRepository } from "./features/account/repository.js";
import { createBackgroundRepository } from "./features/background/repository.js";

export function createRepositories(db: Database) {
  return {
    offboardings: createOffboardingsRepository(db),
    integrations: createIntegrationsRepository(db),
    actionConfigs: createActionConfigsRepository(db),
    team: createTeamRepository(db),
    equipment: createEquipmentRepository(db),
    exitSurveys: createExitSurveysRepository(db),
    billing: createBillingRepository(db),
    talent: createTalentRepository(db),
    jobs: createJobsRepository(db),
    applications: createApplicationsRepository(db),
    resumes: createResumesRepository(db),
    resumeSuggestions: createSuggestionsRepository(db),
    llmUsage: createUsageRepository(db),
    account: createAccountRepository(db),
    background: createBackgroundRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
