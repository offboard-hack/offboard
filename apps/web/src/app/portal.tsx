import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/shadcn/breadcrumb";
import { classProps } from "../shared/lib/class-props";
import { Button } from "../shared/ui/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  getRouteApi,
  lazyRouteComponent,
  notFound,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useCallback } from "react";
import type { ReactNode } from "react";
import { offboardingTeams, offboardingsQuery } from "../entities/offboarding";
import type { CaseSummary, OffboardingCase } from "../entities/offboarding";
import { offboardingStyles } from "../features/offboarding/offboarding.styles";
import { PortalLayout } from "./shell";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/shared/ui/shadcn/sidebar";
import { portalStyles as s } from "../shared/ui/surface.styles";

const CaseActions = lazyRouteComponent(() => import("./case-actions"), "CaseActions");

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

const dashboardRoute = getRouteApi("/painel");
const casesRoute = getRouteApi("/desligamentos");
const caseRoute = getRouteApi("/desligamentos_/$caseId");
const importRoute = getRouteApi("/desligamentos_/importar");
const checklistRoute = getRouteApi("/checklist-automatico");
const equipmentRoute = getRouteApi("/bens-e-coleta");
const integrationsRoute = getRouteApi("/integracoes");
const applicationsRoute = getRouteApi("/candidaturas-assistidas");
const feedbackRoute = getRouteApi("/resultados-e-feedback");
const accessRoute = getRouteApi("/acessos-ao-app");
const plansRoute = getRouteApi("/planos-e-gastos");

export function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export function Portal() {
  const caseMatch = caseRoute.useMatch({ shouldThrow: false });
  const listMatch = casesRoute.useMatch({ shouldThrow: false });
  const dashboardMatch = dashboardRoute.useMatch({ shouldThrow: false });
  const checklistMatch = checklistRoute.useMatch({ shouldThrow: false });
  const applicationsMatch = applicationsRoute.useMatch({ shouldThrow: false });
  const feedbackMatch = feedbackRoute.useMatch({ shouldThrow: false });
  const integrationsMatch = integrationsRoute.useMatch({ shouldThrow: false });
  const equipmentMatch = equipmentRoute.useMatch({ shouldThrow: false });
  const accessMatch = accessRoute.useMatch({ shouldThrow: false });
  const plansMatch = plansRoute.useMatch({ shouldThrow: false });
  const importMatch = importRoute.useMatch({ shouldThrow: false });
  const portalRouter = useRouter();

  const observeMain = useCallback(
    (main: HTMLElement | null) => {
      if (!main) {
        return;
      }

      let previousHeading: HTMLElement | null = null;
      let previousHeadingText = "";
      let focusOnChange = false;
      let errorTitle = "";

      function updateHeading() {
        const heading = document.getElementById("titulo-pagina");
        const title = heading?.textContent ?? "";

        if (!heading || (heading === previousHeading && title === previousHeadingText)) {
          return;
        }

        previousHeading = heading;
        previousHeadingText = title;

        const active = document.activeElement;

        if (errorTitle && (active === document.body || active === main)) {
          focusOnChange = true;
        }

        if (heading.hasAttribute("data-error-heading")) {
          errorTitle = `${title} · Offboard`;
          document.title = errorTitle;
        } else if (errorTitle) {
          if (document.title === errorTitle) {
            document.title = `${title} · Offboard`;
          }

          errorTitle = "";
        }

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

      observer.observe(main, { childList: true, characterData: true, subtree: true });
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
      fullWidth={Boolean(
        listMatch ||
        caseMatch ||
        dashboardMatch ||
        checklistMatch ||
        applicationsMatch ||
        feedbackMatch ||
        equipmentMatch ||
        accessMatch ||
        plansMatch ||
        integrationsMatch,
      )}
      mainRef={observeMain}
      navigation={<PortalNavigation detailActive={Boolean(caseMatch || importMatch)} />}
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
        to: "/painel",
        label: "Painel",
        icon: "M3 3h7v10H3zM14 3h7v6h-7zM3 17h7v4H3zM14 13h7v8h-7z",
      },
      { to: "/desligamentos", label: "Desligamentos", icon: "M11 4H4v16h7m4-12 4 4-4 4m4-4H8" },
      {
        to: "/checklist-automatico",
        label: "Checklist automático",
        icon: "m3 6 2 2 3-3m3 2h10M3 13l2 2 3-3m3 2h10m-10 6h10",
      },
      {
        to: "/bens-e-coleta",
        label: "Bens e coleta",
        icon: "M4 8h16v12H4zM3 4h18v4H3zm7 8h4",
      },
    ],
  },
  {
    label: "Transição",
    links: [
      {
        to: "/candidaturas-assistidas",
        label: "Candidaturas assistidas",
        icon: "M3 8h18v12H3zM8 8V4h8v4M3 13h18m-11 0v2h4v-2",
      },
      {
        to: "/resultados-e-feedback",
        label: "Resultados e feedback",
        icon: "M4 4v16h16M8 15l4-4 3 2 5-6",
      },
      {
        to: "/acessos-ao-app",
        label: "Acessos ao app",
        icon: "M14 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM3 20a7 5 0 0 1 14 0m2-13v6m-3-3h6",
      },
    ],
  },
  {
    label: "Administração",
    links: [
      {
        to: "/integracoes",
        label: "Integrações",
        icon: "M9 4v4m6-4v4M6 8h12v2a6 6 0 0 1-6 6v4M6 8v2a6 6 0 0 0 6 6",
      },
      {
        to: "/planos-e-gastos",
        label: "Planos e gastos",
        icon: "M5 3h14v18l-3-2-4 2-4-2-3 2zM9 8h6m-6 4h6",
      },
    ],
  },
];

function PortalNavigation({ detailActive }: { detailActive: boolean }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { setOpenMobile } = useSidebar();

  return (
    <nav aria-label="Portal do RH">
      {navigationGroups.map(({ label, links }) => (
        <SidebarGroup key={label} role="group" aria-label={label}>
          <SidebarGroupLabel>{label}</SidebarGroupLabel>
          <SidebarMenu>
            {links.map(({ to, label, icon }) => {
              const parentActive = to === "/desligamentos" && detailActive;

              return (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    isActive={pathname === to || parentActive}
                    tooltip={label}
                    render={
                      <Link
                        to={to}
                        aria-label={label}
                        activeOptions={{ exact: true }}
                        aria-current={parentActive ? "location" : undefined}
                        onClick={(event) => {
                          if (
                            !event.metaKey &&
                            !event.ctrlKey &&
                            !event.shiftKey &&
                            !event.altKey
                          ) {
                            setOpenMobile(false);
                          }
                        }}
                      />
                    }
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={icon} />
                    </svg>
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </nav>
  );
}

function CaseLink(item: CaseSummary) {
  return (
    <Link
      to="/desligamentos/$caseId"
      params={{ caseId: item.id }}
      {...classProps(offboardingStyles.caseLink)}
    >
      {item.name}
    </Link>
  );
}

export function Dashboard() {
  const { data: cases } = useSuspenseQuery(offboardingsQuery);
  const { area = "", deadline = "all" } = dashboardRoute.useSearch();
  const navigate = dashboardRoute.useNavigate();

  return (
    <DashboardPage
      cases={cases}
      areaFilter={area}
      deadlineFilter={deadline}
      onAreaChange={(next) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            area: offboardingTeams.find((team) => team === next),
          }),
          resetScroll: false,
        })
      }
      onDeadlineChange={(next) =>
        void navigate({
          search: (previous) => ({ ...previous, deadline: next === "all" ? undefined : next }),
          resetScroll: false,
        })
      }
      renderCaseLink={(id, content, xstyle) => (
        <Link to="/desligamentos/$caseId" params={{ caseId: id }} {...classProps(xstyle)}>
          {content}
        </Link>
      )}
    />
  );
}

export function Cases() {
  const { data: cases } = useSuspenseQuery(offboardingsQuery);
  const { area, status = "", team = "", page } = casesRoute.useSearch();
  const navigate = casesRoute.useNavigate();
  const department = area ?? "";

  return (
    <CasesPage
      cases={cases}
      department={department}
      status={status}
      team={team}
      onStatusChange={(next) =>
        void navigate({
          search: (previous) => ({ ...previous, status: next || undefined, page: undefined }),
          resetScroll: false,
        })
      }
      onTeamChange={(next) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            team: offboardingTeams.find((team) => team === next),
            page: undefined,
          }),
          resetScroll: false,
        })
      }
      onResetFilters={() =>
        void navigate({
          search: (previous) => ({ pageSize: previous.pageSize }),
          resetScroll: false,
        })
      }
      onNameSearchChange={() => {
        if (page) {
          void navigate({
            search: (previous) => ({ ...previous, page: undefined }),
            replace: true,
            resetScroll: false,
          });
        }
      }}
      onDepartmentChange={(next) => {
        if (department !== next) {
          void navigate({
            search: (previous) => ({ ...previous, area: next || undefined, page: undefined }),
            resetScroll: false,
          });
        }
      }}
      renderCaseLink={CaseLink}
      onOpenCase={({ id }) => {
        void navigate({ to: "/desligamentos/$caseId", params: { caseId: id } });
      }}
      breadcrumb={
        <Breadcrumb aria-label="Localização">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/painel" />}>Painel</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Desligamentos</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
      actions={<CaseActions />}
    />
  );
}

export function Case() {
  const { caseId } = caseRoute.useParams();
  const { tasks } = caseRoute.useSearch();
  const navigate = caseRoute.useNavigate();
  const { data: cases } = useSuspenseQuery(offboardingsQuery);
  const offboardingCase = getCase(cases, caseId);

  return (
    <CasePage
      offboardingCase={offboardingCase}
      taskFilter={tasks ?? ""}
      onTaskFilterChange={(next) =>
        void navigate({ search: { tasks: next || undefined }, resetScroll: false })
      }
      breadcrumb={
        <Breadcrumb aria-label="Localização">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/painel" />}>Painel</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/desligamentos" activeOptions={{ exact: true }} />}>
                Desligamentos
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{offboardingCase.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    />
  );
}

export function getCase(cases: OffboardingCase[], caseId: string) {
  const offboardingCase = cases.find((item) => item.id === caseId);

  if (!offboardingCase) {
    throw notFound();
  }

  return offboardingCase;
}

export function BulkImport() {
  return (
    <ImportPage
      returnLink={
        <Link to="/desligamentos" {...classProps(s.backLink)}>
          Voltar para desligamentos
        </Link>
      }
    />
  );
}

export function NotFoundPage() {
  return (
    <section {...classProps(s.panel, s.panelEmpty)}>
      <h1 {...classProps(s.heading)} id="titulo-pagina" tabIndex={-1} data-error-heading>
        Página não encontrada
      </h1>
      <Link to="/desligamentos" {...classProps(s.backLink)}>
        Voltar para desligamentos
      </Link>
    </section>
  );
}

export function RouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <section {...classProps(s.panel, s.panelEmpty)} role="alert">
      <h1 {...classProps(s.heading)} id="titulo-pagina" tabIndex={-1} data-error-heading>
        Não foi possível carregar a página
      </h1>
      <Button type="button" onClick={() => void router.invalidate({ sync: true }).then(reset)}>
        Tentar novamente
      </Button>
    </section>
  );
}

Dashboard.preload = DashboardPage.preload;

Cases.preload = CasesPage.preload;

Case.preload = CasePage.preload;

BulkImport.preload = ImportPage.preload;
