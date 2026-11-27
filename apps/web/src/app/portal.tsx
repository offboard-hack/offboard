import { classProps } from "../shared/lib/class-props";
import { Button } from "../shared/ui/button";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  getRouteApi,
  useLocation,
  useMatches,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { createPortalAbility, type PortalPrincipal } from "@offboard/access";
import type { ErrorComponentProps } from "@tanstack/react-router";
import type { FileRoutesByTo } from "./routeTree.gen";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { Progress } from "@/shared/ui/shadcn/progress";
import { PortalLayout, PortalSidebarLink } from "./shell";
import { PortalSidebarUser } from "./sidebar-user";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/shared/ui/shadcn/sidebar";
import { portalStyles as s } from "../shared/ui/surface.styles";

const portalRoute = getRouteApi("/_portal");

function NavigationProgress() {
  const navigating = useRouterState({
    select: ({ status, location, resolvedLocation }) =>
      status === "pending" &&
      resolvedLocation !== undefined &&
      (location.pathname !== resolvedLocation.pathname ||
        location.searchStr !== resolvedLocation.searchStr),
  });

  return navigating ? (
    <Progress
      value={null}
      aria-label="Carregando página"
      aria-valuetext="Em andamento"
      className="navigation-progress pointer-events-none fixed inset-x-0 top-0 z-50"
    />
  ) : null;
}

export function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        <NavigationProgress />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export function Portal() {
  const { principal } = portalRoute.useRouteContext();
  const activeRoute = useMatches({ select: (matches) => matches.at(-1)?.routeId ?? "" });
  const importActive = activeRoute === "/_portal/desligamentos_/importar";
  const caseActive = activeRoute === "/_portal/desligamentos_/$caseId";

  const fullWidth =
    activeRoute.startsWith("/_portal/") && !importActive && activeRoute !== "/_portal/sem-acesso";

  return (
    <PortalLayout
      fullWidth={fullWidth}
      accountMenu={<PortalSidebarUser principal={principal} />}
      navigation={
        <PortalNavigation principal={principal} detailActive={caseActive || importActive} />
      }
    >
      <Outlet />
    </PortalLayout>
  );
}

const navigationGroups: {
  label: string;
  links: {
    to: keyof FileRoutesByTo;
    label: string;
    icon: string;
    subject?: "Team" | "Integrations" | "Billing";
    action?: "read" | "manage";
  }[];
}[] = [
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
        subject: "Integrations",
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
        to: "/equipe",
        label: "Equipe",
        subject: "Team",
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
        subject: "Integrations",
        icon: "M9 4v4m6-4v4M6 8h12v2a6 6 0 0 1-6 6v4M6 8v2a6 6 0 0 0 6 6",
      },
      {
        to: "/planos-e-gastos",
        label: "Planos e gastos",
        subject: "Billing",
        action: "read",
        icon: "M5 3h14v18l-3-2-4 2-4-2-3 2zM9 8h6m-6 4h6",
      },
    ],
  },
];

function PortalNavigation({
  principal,
  detailActive,
}: {
  principal: PortalPrincipal;
  detailActive: boolean;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const ability = createPortalAbility(principal.role);

  const groups = navigationGroups.map(({ label, links }) => ({
    label,
    links: links.filter(
      ({ subject, action }) => !subject || ability.can(action ?? "manage", subject),
    ),
  }));

  return (
    <nav aria-label="Portal do RH">
      {groups.map(
        ({ label, links }) =>
          links.length > 0 && (
            <SidebarGroup key={label} role="group" aria-label={label}>
              <SidebarGroupLabel>{label}</SidebarGroupLabel>
              <SidebarMenu>
                {links.map(({ to, label, icon }) => {
                  const parentActive = to === "/desligamentos" && detailActive;

                  return (
                    <PortalSidebarLink
                      key={to}
                      isActive={pathname === to || parentActive}
                      label={label}
                      render={
                        <Link
                          to={to}
                          activeOptions={{ exact: true }}
                          aria-current={parentActive ? "location" : undefined}
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
                    </PortalSidebarLink>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ),
      )}
    </nav>
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

export function RouteError({
  reset,
  title = "Não foi possível carregar a página",
  description,
  action,
  restoreFocus = false,
}: Pick<ErrorComponentProps, "reset"> & {
  title?: string;
  description?: string;
  action?: ReactNode;
  restoreFocus?: boolean;
}) {
  const router = useRouter();
  const queryError = useQueryErrorResetBoundary();

  return (
    <section {...classProps(s.panel, s.panelEmpty)} role="alert">
      <h1
        {...classProps(s.heading, description && "w-fit text-foreground")}
        id="titulo-pagina"
        tabIndex={-1}
        data-error-heading
        ref={restoreFocus ? (heading) => heading?.focus({ preventScroll: true }) : undefined}
      >
        {title}
      </h1>
      {description ? <p className={s.description}>{description}</p> : null}
      <div className={action ? "mt-4 flex flex-wrap items-start gap-2" : undefined}>
        <Button
          type="button"
          variant={action ? "primary" : "secondary"}
          onClick={() => {
            queryError.reset();
            void router.invalidate({ sync: true }).then(() => {
              if (restoreFocus) {
                flushSync(reset);
                document.getElementById("titulo-pagina")?.focus({ preventScroll: true });
              } else {
                reset();
              }
            });
          }}
        >
          Tentar novamente
        </Button>
        {action}
      </div>
    </section>
  );
}
