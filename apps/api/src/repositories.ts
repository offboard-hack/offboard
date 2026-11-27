import { createEmployeeRepository } from "./features/employee/repository.js";
import type { Database } from "@offboard/db/client";
import { createOffboardingsRepository } from "./features/offboardings/repository.js";
import { createIntegrationsRepository } from "./features/integrations/repository.js";
import { createActionConfigsRepository } from "./features/action-configs/repository.js";
import { createBenefitRepository } from "./features/benefits/repository.js";
import { createBillingRepository } from "./features/billing/repository.js";
import { createCareerPlanRepository } from "./features/career-plan/repository.js";
import { createEquipmentRepository } from "./features/equipment/repository.js";
import { createExitSurveysRepository } from "./features/exit-surveys/repository.js";
import { createOrganizationsRepository } from "./features/organizations/repository.js";
import { createTeamRepository } from "./features/team/repository.js";
import { createTalentRepository } from "./features/talent/repository.js";
import { createJobsRepository } from "./features/jobs/repository.js";
import { createApplicationsRepository } from "./features/applications/repository.js";
import { createResumesRepository } from "./features/resumes/repository.js";
import { createSuggestionsRepository } from "./features/resumes/suggestions.js";
import { createVersionsRepository } from "./features/resumes/versions.js";
import { createMatchesRepository } from "./features/matches/repository.js";
import { createUsageRepository } from "./shared/llm-usage.js";
import { createAccountRepository } from "./features/account/repository.js";
import { createBackofficeRepository } from "./features/backoffice/repository.js";
import { createBackgroundRepository } from "./features/background/repository.js";
import { createPagesRepository } from "./features/pages/repository.js";
import { createInsightsRepository } from "./features/insights/repository.js";
import { createAiApplyRepository } from "./features/ai-apply/repository.js";
import { createAnswersRepository } from "./features/preferences/answers.js";
import { createPackagesRepository } from "./features/preferences/package.js";
import { createRejectionsRepository } from "./features/preferences/rejections.js";
import { createPreferencesRepository } from "./features/preferences/repository.js";
import { createSourcesRepository } from "./features/sources/repository.js";
import { createDemoRepository } from "./features/demo/repository.js";

export function createRepositories(db: Database) {
  return {
    offboardings: createOffboardingsRepository(db),
    integrations: createIntegrationsRepository(db),
    actionConfigs: createActionConfigsRepository(db),
    team: createTeamRepository(db),
    equipment: createEquipmentRepository(db),
    exitSurveys: createExitSurveysRepository(db),
    billing: createBillingRepository(db),
    backoffice: createBackofficeRepository(db),
    benefits: createBenefitRepository(db),
    careerPlan: createCareerPlanRepository(db),
    employee: createEmployeeRepository(db),
    organizations: createOrganizationsRepository(db),
    talent: createTalentRepository(db),
    jobs: createJobsRepository(db),
    applications: createApplicationsRepository(db),
    resumes: createResumesRepository(db),
    resumeSuggestions: createSuggestionsRepository(db),
    resumeVersions: createVersionsRepository(db),
    llmUsage: createUsageRepository(db),
    matches: createMatchesRepository(db),
    account: createAccountRepository(db),
    background: createBackgroundRepository(db),
    pages: createPagesRepository(db),
    insights: createInsightsRepository(db),
    sources: createSourcesRepository(db),
    demo: createDemoRepository(db),
    preferences: createPreferencesRepository(db),
    answers: createAnswersRepository(db),
    rejections: createRejectionsRepository(db),
    packages: createPackagesRepository(db),
    aiApply: createAiApplyRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
