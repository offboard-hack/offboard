import { CreditCardIcon, UnfoldMoreIcon, UserAccountIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { Avatar, AvatarFallback } from "@/shared/ui/shadcn/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/shadcn/dropdown-menu";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/shared/ui/shadcn/sidebar";

const user = { name: "Beatriz Castro", initials: "BC", role: "Admin" };

export function SidebarUser() {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarFooter className="border-t border-sidebar-border">
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Menu de usuário de ${user.name}`}
              render={
                <SidebarMenuButton
                  size="lg"
                  className="aria-expanded:bg-sidebar-accent group-data-[collapsible=icon]:justify-center"
                />
              }
            >
              <Avatar aria-hidden="true" className="group-data-[collapsible=icon]:size-6">
                <AvatarFallback className="bg-sidebar-primary/10 text-xs font-semibold text-sidebar-primary dark:text-sidebar-primary-foreground">
                  {user.initials}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.role}</span>
              </span>
              <HugeiconsIcon
                icon={UnfoldMoreIcon}
                className="ml-auto text-muted-foreground group-data-[collapsible=icon]:hidden"
                aria-hidden="true"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side={isMobile ? "top" : "right"}
              align="end"
              sideOffset={8}
              className="min-w-52"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-medium text-foreground">
                  {user.name}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  render={<Link to="/acessos-ao-app" />}
                  onClick={() => setOpenMobile(false)}
                >
                  <HugeiconsIcon icon={UserAccountIcon} aria-hidden="true" />
                  Acessos ao app
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={<Link to="/planos-e-gastos" />}
                  onClick={() => setOpenMobile(false)}
                >
                  <HugeiconsIcon icon={CreditCardIcon} aria-hidden="true" />
                  Planos e gastos
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
