import { useRouter } from "@tanstack/react-router";
import { type ComponentProps, type ReactNode, useCallback } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/shared/ui/shadcn/sidebar";

const logo = "/offboard-logo.svg";
const logoLight = "/offboard-logo-branco.svg";
const icon = "/offboard-icon.svg";

export function PortalLayout({
  children,
  navigation,
  fullWidth,
  accountMenu,
  workspaceName = "Aurora Tecnologia",
  focusOnSearch = false,
  sidebarDescription,
  onMainMount,
}: {
  children: ReactNode;
  navigation: ReactNode;
  fullWidth: boolean;
  accountMenu: ReactNode;
  workspaceName?: string;
  focusOnSearch?: boolean;
  sidebarDescription?: string;
  onMainMount?: () => () => void;
}) {
  const mainRef = usePortalMainFocus(focusOnSearch, onMainMount);

  return (
    <SidebarProvider>
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:border focus:bg-background focus:p-3"
        href="#conteudo"
      >
        Ir para o conteúdo
      </a>
      <Sidebar collapsible="icon" mobileDescription={sidebarDescription}>
        <SidebarHeader>
          <div className="px-2 py-1 group-data-[collapsible=icon]:p-0">
            <div className="group-data-[collapsible=icon]:hidden">
              <img src={logo} alt="Offboard" className="h-9 w-auto dark:hidden" />
              <img src={logoLight} alt="Offboard" className="hidden h-9 w-auto dark:block" />
            </div>
            <img
              src={icon}
              alt="Offboard"
              className="mx-auto hidden size-6 group-data-[collapsible=icon]:block"
            />
          </div>
        </SidebarHeader>
        <SidebarContent>{navigation}</SidebarContent>
        {accountMenu}
      </Sidebar>
      <SidebarInset id="conteudo" ref={mainRef} tabIndex={-1} className="min-w-0">
        <header className="flex min-h-12 items-center gap-2 border-b px-2">
          <SidebarTrigger aria-label="Menu do portal" />
          <img src={icon} alt="Offboard" className="size-6 shrink-0 md:hidden" />
          <span className="text-sm font-medium">{workspaceName}</span>
        </header>
        <div
          className={
            fullWidth
              ? "w-full min-w-0"
              : "mx-auto w-full min-w-0 max-w-7xl px-4 py-6 sm:px-8 sm:py-8"
          }
        >
          {children}
        </div>
        <footer className="mt-auto border-t px-4 py-2 text-center text-xs text-muted-foreground">
          <a href="https://www.siterastreio.com.br/" target="_blank" rel="noopener noreferrer">
            Rastreamento
          </a>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function PortalSidebarLink({
  label,
  isActive,
  render,
  children,
}: {
  label: string;
  isActive: boolean;
  render: ComponentProps<typeof SidebarMenuButton>["render"];
  children: ReactNode;
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={label}
        render={render}
        aria-label={label}
        onClick={(event) => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            setOpenMobile(false);
          }
        }}
      >
        {children}
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function usePortalMainFocus(focusOnSearch: boolean, onMainMount?: () => () => void) {
  const router = useRouter();

  return useCallback(
    (main: HTMLElement | null) => {
      if (!main) {
        return;
      }

      let previousHeading: HTMLElement | null = null;
      let previousHeadingText = "";
      let focusOnChange = false;
      let titleBeforeError = "";
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
          if (!errorTitle) titleBeforeError = document.title;

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

      const stop = router.subscribe(
        "onBeforeNavigate",
        ({ fromLocation, pathChanged, hrefChanged }) => {
          if (fromLocation && (pathChanged || (focusOnSearch && hrefChanged))) {
            focusOnChange = true;
          }
        },
      );

      const observer = new MutationObserver(updateHeading);

      observer.observe(main, { childList: true, characterData: true, subtree: true });
      updateHeading();
      const unmount = onMainMount?.();

      return () => {
        observer.disconnect();
        stop();
        unmount?.();

        if (errorTitle && document.title === errorTitle) document.title = titleBeforeError;
      };
    },
    [router, focusOnSearch, onMainMount],
  );
}
