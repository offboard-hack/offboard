import { Button } from "../shared/ui/button";
import * as stylex from "@stylexjs/stylex";
import { QueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  dashboardQuery,
  offboardingDetailQuery,
  offboardingDepartments,
  offboardingTeams,
  offboardingsQuery,
} from "../entities/offboarding";
import {
  beneficiariesQuery,
  checklistQuery,
  equipmentQuery,
  integrationsQuery,
  plansQuery,
  teamMembersQuery,
} from "../shared/api";
import type { CaseSummary } from "../entities/offboarding";
import { deadlineGroups } from "../features/dashboard/deadline";
import type { DeadlineGroup } from "../features/dashboard/deadline";
import { equipmentStatus } from "../features/asset-returns/status";
import { offboardingStyles } from "../features/offboarding/offboarding.styles";
import { MobileNavigation } from "./mobile-navigation";
import { PortalLayout } from "./shell";
import { shellStyles as shell } from "./shell.styles";
import { portalStyles as s } from "../shared/ui/surface.styles";

const CasesPage = lazyRouteComponent(
  () => import("../features/offboarding/offboarding-pages"),
  "CasesPage",
);

const CasePage = lazyRouteComponent(
  () => import("../features/offboarding/offboarding-pages"),
  "CasePage",
);

const ImportPage = lazyRouteComponent(
  () => import("../features/bulk-import/import-page"),
  "ImportPage",
);

const DashboardPage = lazyRouteComponent(
  () => import("../features/dashboard/dashboard-page"),
  "DashboardPage",
);

type CasesSearch = { area?: string };

type DashboardSearch = CasesSearch & { deadline?: DeadlineGroup };

type EquipmentSearch = { status?: string };

type CaseSearch = { tasks?: "pending" | "done" };

type IntegrationsSearch = { status?: "connected" | "disconnected" };

export const queryClient = new QueryClient();

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Portal,
  notFoundComponent: NotFoundPage,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/desligamentos", replace: true });
  },
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/painel",
  validateSearch: (search) => {
    const filters: DashboardSearch = {
      area: offboardingTeams.find((team) => team === search.area),
      deadline: deadlineGroups.find((group) => group === search.deadline),
    };

    return filters;
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(dashboardQuery);
  },
  component: Object.assign(Dashboard, { preload: DashboardPage.preload }),
});

const casesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/desligamentos",
  validateSearch: (search) => {
    const filters: CasesSearch = {
      area: offboardingDepartments.find((department) => department === search.area),
    };

    return filters;
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(offboardingsQuery);
  },
  component: Object.assign(Cases, { preload: CasesPage.preload }),
});

const caseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/desligamentos/$caseId",
  validateSearch: (search) => {
    const filters: CaseSearch = {
      tasks: search.tasks === "pending" || search.tasks === "done" ? search.tasks : undefined,
    };

    return filters;
  },
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(offboardingDetailQuery(params.caseId));
  },
  component: Object.assign(Case, { preload: CasePage.preload }),
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/desligamentos/importar",
  component: Object.assign(BulkImport, { preload: ImportPage.preload }),
});

const checklistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/checklist-automatico",
  component: lazyRouteComponent(
    () => import("../features/checklist/checklist-page"),
    "ChecklistRulesPage",
  ),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(checklistQuery);
  },
});

const equipmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bens-e-coleta",
  validateSearch: (search) => {
    const filters: EquipmentSearch = {
      status: Object.keys(equipmentStatus).find((value) => value === search.status),
    };

    return filters;
  },
  component: lazyRouteComponent(
    () => import("../features/asset-returns/equipment-page"),
    "EquipmentPage",
  ),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(equipmentQuery);
  },
});

const integrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/integracoes",
  validateSearch: (search) => {
    const filters: IntegrationsSearch = {
      status:
        search.status === "connected" || search.status === "disconnected"
          ? search.status
          : undefined,
    };

    return filters;
  },
  component: lazyRouteComponent(
    () => import("../features/integrations/integrations-page"),
    "IntegrationsPage",
  ),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(integrationsQuery);
  },
});

const applicationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/candidaturas-assistidas",
  component: lazyRouteComponent(
    () => import("../features/transition-insights/insights-pages"),
    "ApplicationsPage",
  ),
});

const feedbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/resultados-e-feedback",
  component: lazyRouteComponent(
    () => import("../features/transition-insights/insights-pages"),
    "FeedbackPage",
  ),
});

const accessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/acessos-ao-app",
  component: lazyRouteComponent(() => import("../features/app-access/access-page"), "AccessPage"),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(beneficiariesQuery),
      context.queryClient.ensureQueryData(teamMembersQuery),
    ]);
  },
});

const plansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/planos-e-gastos",
  component: lazyRouteComponent(() => import("../features/billing/billing-page"), "PlansPage"),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(plansQuery);
  },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    dashboardRoute,
    casesRoute,
    caseRoute,
    importRoute,
    checklistRoute,
    equipmentRoute,
    integrationsRoute,
    applicationsRoute,
    feedbackRoute,
    accessRoute,
    plansRoute,
  ]),
  context: { queryClient },
  defaultErrorComponent: RouteError,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function Portal() {
  const caseMatch = caseRoute.useMatch({ shouldThrow: false });
  const portalRouter = useRouter();

  const observeMain = useCallback(
    (main: HTMLElement | null) => {
      if (!main) {
        return;
      }

      let previousHeading: HTMLElement | null = null;
      let previousTitle = "";
      let focusOnChange = false;

      function updateHeading() {
        const heading = document.getElementById("titulo-pagina");
        const title = heading?.textContent ?? "";

        if (!heading || (heading === previousHeading && title === previousTitle)) {
          return;
        }

        previousHeading = heading;
        previousTitle = title;
        document.title = `${title} · Offboard`;

        if (focusOnChange) {
          focusOnChange = false;
          heading.focus({ preventScroll: true });
        }
      }

      const stop = portalRouter.subscribe("onBeforeNavigate", ({ fromLocation, pathChanged }) => {
        if (fromLocation && pathChanged) {
          focusOnChange = true;
        }
      });

      const observer = new MutationObserver(updateHeading);

      observer.observe(main, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      updateHeading();

      return () => {
        observer.disconnect();
        stop();
      };
    },
    [portalRouter],
  );

  return (
    <PortalLayout
      mainRef={observeMain}
      navigation={<PortalNavigation detailActive={Boolean(caseMatch)} />}
    >
      <Outlet />
    </PortalLayout>
  );
}

const navigationGroups = [
  {
    label: "Operação",
    links: [
      {
        to: dashboardRoute.fullPath,
        label: "Painel",
        icon: "M3 3h7v10H3zM14 3h7v6h-7zM3 17h7v4H3zM14 13h7v8h-7z",
      },
      {
        to: casesRoute.fullPath,
        label: "Desligamentos",
        icon: "M11 4H4v16h7m4-12 4 4-4 4m4-4H8",
      },
      {
        to: importRoute.fullPath,
        label: "Cadastro em massa",
        icon: "M5 15v5h14v-5M12 16V4m-4 4 4-4 4 4",
      },
      {
        to: checklistRoute.fullPath,
        label: "Checklist automático",
        icon: "m3 6 2 2 3-3m3 2h10M3 13l2 2 3-3m3 2h10m-10 6h10",
      },
      {
        to: equipmentRoute.fullPath,
        label: "Bens e coleta",
        icon: "M4 8h16v12H4zM3 4h18v4H3zm7 8h4",
      },
    ],
  },
  {
    label: "Transição",
    links: [
      {
        to: applicationsRoute.fullPath,
        label: "Candidaturas assistidas",
        icon: "M3 8h18v12H3zM8 8V4h8v4M3 13h18m-11 0v2h4v-2",
      },
      {
        to: feedbackRoute.fullPath,
        label: "Resultados e feedback",
        icon: "M4 4v16h16M8 15l4-4 3 2 5-6",
      },
      {
        to: accessRoute.fullPath,
        label: "Acessos ao app",
        icon: "M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM3 20a7 5 0 0 1 14 0m2-13v6m-3-3h6",
      },
    ],
  },
  {
    label: "Administração",
    links: [
      {
        to: integrationsRoute.fullPath,
        label: "Integrações",
        icon: "M9 4v4m6-4v4M6 8h12v2a6 6 0 0 1-6 6v4M6 8v2a6 6 0 0 0 6 6",
      },
      {
        to: plansRoute.fullPath,
        label: "Planos e gastos",
        icon: "M5 3h14v18l-3-2-4 2-4-2-3 2zM9 8h6m-6 4h6",
      },
    ],
  },
];

function PortalNavigation({ detailActive }: { detailActive: boolean }) {
  const pathname = useLocation({ select: (location) => location.pathname });

  const groups = navigationGroups.map(({ label, links }) => (
    <div key={label} role="group" aria-label={label} {...stylex.props(shell.navGroup)}>
      <span aria-hidden="true" {...stylex.props(shell.navGroupLabel)}>
        {label}
      </span>
      {links.map(({ to, label, icon }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact: true }}
          aria-current={to === casesRoute.fullPath && detailActive ? "location" : undefined}
          {...stylex.props(shell.navLink)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...stylex.props(shell.navIcon)}
          >
            <path d={icon} />
          </svg>
          <span>{label}</span>
        </Link>
      ))}
    </div>
  ));

  return (
    <>
      <nav aria-label="Portal do RH" {...stylex.props(shell.navigation, shell.desktopNavigation)}>
        {groups}
      </nav>
      <MobileNavigation key={pathname}>
        <nav aria-label="Portal do RH" {...stylex.props(shell.navigation)}>
          {groups}
        </nav>
      </MobileNavigation>
    </>
  );
}

function CaseLink(item: CaseSummary) {
  return (
    <Link
      to="/desligamentos/$caseId"
      params={{ caseId: item.id }}
      {...stylex.props(offboardingStyles.caseLink)}
    >
      {item.name}
    </Link>
  );
}

function Dashboard() {
  const { data: cases } = useSuspenseQuery(dashboardQuery);
  const { area = "", deadline = "all" } = dashboardRoute.useSearch();
  const navigate = dashboardRoute.useNavigate();

  return (
    <DashboardPage
      cases={cases}
      areaFilter={area}
      deadlineFilter={deadline}
      onAreaChange={(next) =>
        void navigate({
          search: (previous) => ({ ...previous, area: next || undefined }),
          resetScroll: false,
        })
      }
      onDeadlineChange={(next) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            deadline: next === "all" ? undefined : next,
          }),
          resetScroll: false,
        })
      }
      renderCaseLink={(id, content, xstyle) => (
        <Link to="/desligamentos/$caseId" params={{ caseId: id }} {...stylex.props(xstyle)}>
          {content}
        </Link>
      )}
      importLink={
        <Link to="/desligamentos/importar" {...stylex.props(s.button, s.secondaryButton)}>
          Cadastro em massa
        </Link>
      }
    />
  );
}

function Cases() {
  const { data: cases } = useSuspenseQuery(offboardingsQuery);
  const { area } = casesRoute.useSearch();
  const navigate = casesRoute.useNavigate();
  const department = area ?? "";

  return (
    <CasesPage
      cases={cases}
      department={department}
      onDepartmentChange={(next) => {
        if (department !== next) {
          void navigate({
            search: { area: next || undefined },
            resetScroll: false,
          });
        }
      }}
      renderCaseLink={CaseLink}
      importLink={
        <Link to="/desligamentos/importar" {...stylex.props(s.button, s.primaryButton)}>
          Importar CSV
        </Link>
      }
    />
  );
}

function Case() {
  const { caseId } = caseRoute.useParams();
  const { tasks } = caseRoute.useSearch();
  const navigate = caseRoute.useNavigate();
  const { data: offboardingCase } = useSuspenseQuery(offboardingDetailQuery(caseId));

  return (
    <CasePage
      offboardingCase={offboardingCase}
      taskFilter={tasks ?? ""}
      onTaskFilterChange={(next) =>
        void navigate({
          search: { tasks: next || undefined },
          resetScroll: false,
        })
      }
      backLink={
        <Link to="/desligamentos" {...stylex.props(s.backLink)}>
          Voltar para desligamentos
        </Link>
      }
    />
  );
}

function BulkImport() {
  return (
    <ImportPage
      returnLink={
        <Link to="/desligamentos" {...stylex.props(s.backLink)}>
          Voltar para desligamentos
        </Link>
      }
    />
  );
}

function NotFoundPage() {
  return (
    <section {...stylex.props(s.panel, s.panelEmpty)}>
      <h1 {...stylex.props(s.heading)} id="titulo-pagina" tabIndex={-1}>
        Página não encontrada
      </h1>
      <Link to="/desligamentos" {...stylex.props(s.backLink)}>
        Voltar para desligamentos
      </Link>
    </section>
  );
}

function RouteError({ reset }: ErrorComponentProps) {
  return (
    <section {...stylex.props(s.panel, s.panelEmpty)} role="alert">
      <h1 {...stylex.props(s.heading)} id="titulo-pagina" tabIndex={-1}>
        Não foi possível carregar a página
      </h1>
      <Button type="button" onClick={() => void router.invalidate({ sync: true }).then(reset)}>
        Tentar novamente
      </Button>
    </section>
  );
}
