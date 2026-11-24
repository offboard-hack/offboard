import type { Treaty } from "@offboard/api-client";
import type { ReactNode } from "react";
import { createContext, use } from "react";
import type { getEmployeeApi } from "../features/auth/session";

type EmployeeJourney = Treaty.Data<
  ReturnType<typeof getEmployeeApi>["api"]["employee"]["journey"]["get"]
>;

const JourneyContext = createContext<EmployeeJourney | null>(null);

export function EmployeeJourneyProvider({
  journey,
  children,
}: {
  journey: EmployeeJourney | null;
  children: ReactNode;
}) {
  return <JourneyContext.Provider value={journey}>{children}</JourneyContext.Provider>;
}

export function useEmployeeJourney() {
  return use(JourneyContext);
}
