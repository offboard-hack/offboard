import type { Database } from "@offboard/db/client";
import { createOffboardingsRepository } from "./features/offboardings/repository.js";
import { createIntegrationsRepository } from "./features/integrations/repository.js";
import { createActionConfigsRepository } from "./features/action-configs/repository.js";
import { createEquipmentRepository } from "./features/equipment/repository.js";
import { createTeamRepository } from "./features/team/repository.js";

export function createRepositories(db: Database) {
  return {
    offboardings: createOffboardingsRepository(db),
    integrations: createIntegrationsRepository(db),
    actionConfigs: createActionConfigsRepository(db),
    team: createTeamRepository(db),
    equipment: createEquipmentRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
