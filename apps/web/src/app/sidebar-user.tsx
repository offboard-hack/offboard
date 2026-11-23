import {
  CreditCardIcon,
  LogoutIcon,
  UnfoldMoreIcon,
  UserAccountIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createPortalAbility, type PortalPrincipal } from "@offboard/access";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/features/sign-in/auth-client";
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

const roleLabels = {
  admin: "Admin",
  rh: "RH",
  gestor: "Gestor",
  visualizador: "Visualizador",
};

export function SidebarUser({ principal }: { principal: PortalPrincipal }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const queryClient = useQueryClient();
  const ability = createPortalAbility(principal.role);

  const initials = principal.name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();

      if (error) throw new Error("Failed to sign out");
    },

    onSuccess: () => {
      queryClient.clear();
      window.location.replace("/entrar");
    },
  });

  return (
    <SidebarFooter className="border-t border-sidebar-border">
      {signOut.isError && (
        <p role="alert" className="px-2 text-xs text-destructive">
          Não foi possível sair. Tente novamente.
        </p>
      )}
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Menu de usuário de ${principal.name}`}
              render={
                <SidebarMenuButton
                  size="lg"
                  className="aria-expanded:bg-sidebar-accent group-data-[collapsible=icon]:justify-center"
                />
              }
            >
              <Avatar aria-hidden="true" className="group-data-[collapsible=icon]:size-6">
                <AvatarFallback className="bg-sidebar-primary/10 text-xs font-semibold text-sidebar-primary dark:text-sidebar-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{principal.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {roleLabels[principal.role]}
                </span>
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
                  {principal.name}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {ability.can("manage", "Team") && (
                  <DropdownMenuItem
                    render={<Link to="/equipe" />}
                    onClick={() => setOpenMobile(false)}
                  >
                    <HugeiconsIcon icon={UserAccountIcon} aria-hidden="true" />
                    Equipe
                  </DropdownMenuItem>
                )}
                {ability.can("manage", "Integrations") && (
                  <DropdownMenuItem
                    render={<Link to="/planos-e-gastos" />}
                    onClick={() => setOpenMobile(false)}
                  >
                    <HugeiconsIcon icon={CreditCardIcon} aria-hidden="true" />
                    Planos e gastos
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={signOut.isPending} onClick={() => signOut.mutate()}>
                  <HugeiconsIcon icon={LogoutIcon} aria-hidden="true" />
                  {signOut.isPending ? "Saindo…" : "Sair"}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
