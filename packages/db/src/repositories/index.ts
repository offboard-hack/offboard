import { DrizzleAccessRepository } from "./access.ts";
import { DrizzleBillingRepository } from "./billing.ts";
import { DrizzleChecklistRepository } from "./checklist.ts";
import { DrizzleEquipmentRepository } from "./equipment.ts";
import { DrizzleIntegrationRepository } from "./integration.ts";
import type { Repositories } from "./interfaces.ts";
import { DrizzleOffboardingRepository } from "./offboarding.ts";
import { DrizzleTaskRepository } from "./tasks.ts";
import type { Db } from "./tasks.ts";

export function createRepositories(db: Db) {
  return {
    offboardings: new DrizzleOffboardingRepository(db),
    tasks: new DrizzleTaskRepository(db),
    equipment: new DrizzleEquipmentRepository(db),
    integrations: new DrizzleIntegrationRepository(db),
    access: new DrizzleAccessRepository(db),
    billing: new DrizzleBillingRepository(db),
    checklist: new DrizzleChecklistRepository(db),
  } satisfies Repositories;
}

export {
  DrizzleAccessRepository,
  DrizzleBillingRepository,
  DrizzleChecklistRepository,
  DrizzleEquipmentRepository,
  DrizzleIntegrationRepository,
  DrizzleOffboardingRepository,
  DrizzleTaskRepository,
};
