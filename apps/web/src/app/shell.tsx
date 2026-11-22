import type { ReactNode, Ref } from "react";
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
const logoLight = "/offboard-logo-branco.svg";
const icon = "/offboard-icon.svg";

export function PortalLayout({
  children,
  navigation,
  mainRef,
  fullWidth,
}: {
  children: ReactNode;
  navigation: ReactNode;
  mainRef: Ref<HTMLElement>;
  fullWidth: boolean;
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
        <SidebarUser />
      </Sidebar>
      <SidebarInset id="conteudo" ref={mainRef} tabIndex={-1} className="min-w-0">
        <header className="flex min-h-12 items-center gap-2 border-b px-2">
          <SidebarTrigger aria-label="Menu do portal" />
          <img src={icon} alt="Offboard" className="size-6 shrink-0 md:hidden" />
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
