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
} from "@tanstack/react-router";
import { createPortalAbility, type PortalPrincipal } from "@offboard/access";
import type { ErrorComponentProps } from "@tanstack/react-router";
import type { FileRoutesByTo } from "./routeTree.gen";
import { useCallback } from "react";
import type { ReactNode } from "react";
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

const portalRoute = getRouteApi("/_portal");

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
  const { principal } = portalRoute.useRouteContext();
  const activeRoute = useMatches({ select: (matches) => matches.at(-1)?.routeId ?? "" });
  const importActive = activeRoute === "/_portal/desligamentos_/importar";
  const caseActive = activeRoute === "/_portal/desligamentos_/$caseId";

  const fullWidth =
    activeRoute.startsWith("/_portal/") && !importActive && activeRoute !== "/_portal/sem-acesso";

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
      fullWidth={fullWidth}
      mainRef={observeMain}
      principal={principal}
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
    subject?: "Team" | "Integrations";
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
        subject: "Integrations",
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
  const { setOpenMobile } = useSidebar();
  const ability = createPortalAbility(principal.role);

  const groups = navigationGroups.map(({ label, links }) => ({
    label,
    links: links.filter(({ subject }) => !subject || ability.can("manage", subject)),
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

export function RouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const queryError = useQueryErrorResetBoundary();

  return (
    <section {...classProps(s.panel, s.panelEmpty)} role="alert">
      <h1 {...classProps(s.heading)} id="titulo-pagina" tabIndex={-1} data-error-heading>
        Não foi possível carregar a página
      </h1>
      <Button
        type="button"
        onClick={() => {
          queryError.reset();
          void router.invalidate({ sync: true }).then(reset);
        }}
      >
        Tentar novamente
      </Button>
    </section>
  );
}
