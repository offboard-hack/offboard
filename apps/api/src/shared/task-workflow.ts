export const employeeTeam = "Pessoa desligada";

const equipmentTask = "equipment";
const feedbackTask = "feedback";
const manualTask = "check";

export function employeeTaskAction(stepId: string | null) {
  switch (stepId) {
    case "confirm":
      return equipmentTask;
    case "survey":
      return feedbackTask;
    default:
      return manualTask;
  }
}
