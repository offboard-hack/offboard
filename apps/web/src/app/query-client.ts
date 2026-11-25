import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { EmployeeAccessChanged, employeeQueryKey } from "@/entities/employee";

export function createPortalQueryClient(
  location: Pick<Location, "replace"> | undefined = typeof window === "undefined"
    ? undefined
    : window.location,
) {
  let leavingEmployeeArea = false;

  function onError(error: Error) {
    if (!location || leavingEmployeeArea || !(error instanceof EmployeeAccessChanged)) {
      return;
    }

    leavingEmployeeArea = true;
    queryClient.removeQueries({ queryKey: employeeQueryKey });
    location.replace("/colaborador/entrar");
  }

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
  });

  return queryClient;
}
