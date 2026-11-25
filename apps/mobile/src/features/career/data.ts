import { useEmployeeJourney } from "../../shared/employee-journey";
import { useLocalData } from "../../shared/storage";
import { careerSchema, emptyCareer, initialCareer } from "./model";

export function useCareerData() {
  const journey = useEmployeeJourney();

  return useLocalData(
    "career",
    careerSchema,
    journey ? emptyCareer("", journey.deadline) : initialCareer,
    "confirmed",
  );
}
