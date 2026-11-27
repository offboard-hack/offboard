import { createFileRoute, lazyRouteComponent, redirect } from "@tanstack/react-router";
import { z } from "zod";
import {
  EmployeeAccessChanged,
  employeeJourneyQuery,
  employeeQueryKey,
  employeeStateQuery,
  removeOtherEmployeeQueries,
} from "@/entities/employee";
import { getApiClient } from "@/shared/lib/api-client";

const screens = z.enum([
  "hoje",
  "saida",
  "carreira",
  "curriculo",
  "preferencias",
  "perfil",
  "privacidade",
  "passagem",
  "equipamentos",
  "exame",
  "rescisao",
  "feedback",
]);

export const Route = createFileRoute("/colaborador")({
  validateSearch: z.object({
    tela: screens.default("hoje").catch("hoje"),
    carreira: z.enum(["vagas", "candidaturas"]).default("vagas").catch("vagas"),
    secao: z
      .enum(["perfil", "diversidade", "vagas", "respostas", "dispensadas"])
      .default("perfil")
      .catch("perfil"),
    plano: z.literal("ok").optional().catch(undefined),
  }),
  beforeLoad: async ({ context }) => {
    const result = await getApiClient().api.employee.session.get();

    if (result.status === 401 || result.status === 403) {
      context.queryClient.removeQueries({ queryKey: employeeQueryKey });
      throw redirect({ to: "/colaborador/entrar", replace: true });
    }

    if (result.error) throw new Error("Não foi possível verificar seu acesso.");

    removeOtherEmployeeQueries(context.queryClient, result.data);

    return { account: result.data };
  },
  loader: async ({ context }) => {
    const { account, queryClient } = context;

    try {
      await Promise.all([
        queryClient.ensureQueryData(employeeJourneyQuery(account)),
        queryClient.ensureQueryData(employeeStateQuery(account, "consent")),
        queryClient.ensureQueryData(employeeStateQuery(account, "departure-v1")),
      ]);
    } catch (error) {
      if (!(error instanceof EmployeeAccessChanged)) throw error;

      queryClient.removeQueries({ queryKey: employeeQueryKey });
      throw redirect({ to: "/colaborador/entrar", replace: true });
    }
  },
  head: () => ({
    meta: [{ title: "Minha jornada · Offboard" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: lazyRouteComponent(() => import("../employee"), "EmployeePending"),
  errorComponent: lazyRouteComponent(() => import("../employee"), "EmployeeRouteError"),
  component: lazyRouteComponent(() => import("../employee"), "EmployeePage"),
});
