import type { DispatchAction } from "../../shared/action-dispatch.js";
import type { FireRules } from "../../shared/rule-dispatch.js";
import { trackPackage } from "./correios.js";
import type { OffboardingsRepository } from "./repository.js";

export const CORREIOS_DEFAULT_URL = "https://proxyapp.correios.com.br";

export function createCorreiosCheck(
  repos: OffboardingsRepository,
  dispatchAction: DispatchAction,
  fireRules: FireRules,
  correiosBaseUrl = CORREIOS_DEFAULT_URL,
) {
  return async function checkTrackedShipments() {
    const tracked = await repos.getTrackedTasks();
    const delivered: string[] = [];

    const results = await Promise.allSettled(
      tracked.map(async (task) => {
        // WARNING: getTrackedTasks guarantees non-null trackingCode
        const result = await trackPackage(task.trackingCode as string, correiosBaseUrl);

        if (!result.delivered) return;

        const updated = await repos.updateTaskStatus(task.id, "done");

        if (!updated) return;

        delivered.push(task.id);

        if (task.phase) {
          await dispatchAction({
            taskId: task.id,
            taskTitle: task.title,
            status: "done",
            phase: task.phase,
          });
        }

        const base = {
          task: {
            id: task.id,
            title: task.title,
            status: "done",
            previousStatus: task.status,
            caseId: task.caseId,
          },
          case: { id: task.caseId, name: task.caseName },
        };

        const pickups = await repos.getPendingPickupEquipment(task.caseId);

        if (pickups.length === 0) {
          await fireRules("correios.delivered", base);
        }

        for (const item of pickups) {
          await fireRules("correios.delivered", {
            ...base,
            equipment: { ...item, taskId: task.id },
          });
        }
      }),
    );

    return { checked: results.length, delivered };
  };
}
