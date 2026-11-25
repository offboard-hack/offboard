import { consentSchema } from "@offboard/employee";
import { useLocalData } from "../../shared/storage";

const initialConsent = { accepted: false };

export function useConsent() {
  return useLocalData("consent", consentSchema, initialConsent);
}
