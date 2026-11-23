import type { ReactNode, Ref } from "react";
import type { PortalPrincipal } from "@offboard/access";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/shared/ui/shadcn/sidebar";
import { SidebarUser } from "./sidebar-user";

const logo = "/offboard-logo.svg";

export function PortalLayout({
  children,
  navigation,
  mainRef,
  fullWidth,
  principal,
}: {
  children: ReactNode;
  navigation: ReactNode;
  mainRef: Ref<HTMLElement>;
  fullWidth: boolean;
  principal: PortalPrincipal;
}) {
  return (
    <SidebarProvider>
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:border focus:bg-background focus:p-3"
        href="#conteudo"
      >
        Ir para o conteúdo
      </a>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="px-2 py-1 group-data-[collapsible=icon]:p-0">
            <div className="group-data-[collapsible=icon]:hidden">
              <svg
                role="img"
                aria-label="Offboard"
                viewBox="0 0 877 256"
                className="h-9 w-auto fill-sidebar-foreground text-primary dark:text-sidebar-primary"
              >
                <use href={`${logo}#wordmark`} />
              </svg>
            </div>
            <svg
              role="img"
              aria-label="Offboard"
              viewBox="0 0 256 256"
              className="mx-auto hidden size-6 text-primary group-data-[collapsible=icon]:block dark:text-sidebar-primary"
            >
              <use href={`${logo}#mark`} />
            </svg>
          </div>
        </SidebarHeader>
        <SidebarContent>{navigation}</SidebarContent>
        <SidebarUser principal={principal} />
      </Sidebar>
      <SidebarInset id="conteudo" ref={mainRef} tabIndex={-1} className="min-w-0">
        <header className="flex min-h-12 items-center gap-2 border-b px-2">
          <SidebarTrigger aria-label="Menu do portal" />
          <svg
            role="img"
            aria-label="Offboard"
            viewBox="0 0 256 256"
            className="size-6 shrink-0 text-primary md:hidden dark:text-sidebar-primary"
          >
            <use href={`${logo}#mark`} />
          </svg>
          <span className="text-sm font-medium">Aurora Tecnologia</span>
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
      </SidebarInset>
    </SidebarProvider>
  );
}
