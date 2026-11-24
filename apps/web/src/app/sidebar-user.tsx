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
import type { ComponentProps, ReactNode } from "react";
import { notifySessionChange } from "@/shared/lib/session-change";
import { Avatar, AvatarFallback } from "@/shared/ui/shadcn/avatar";
import { Button } from "@/shared/ui/shadcn/button";
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

type SignInPath = "/entrar" | "/colaborador/entrar";

const signOutError = "Não foi possível sair. Tente novamente.";

function usePortalSignOut(signInPath: SignInPath) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();

      if (error) throw new Error(signOutError);
    },
    onSuccess: () => {
      queryClient.clear();
      notifySessionChange();
      window.location.replace(signInPath);
    },
  });
}

export function PortalSignOut({ signInPath }: { signInPath: SignInPath }) {
  const signOut = usePortalSignOut(signInPath);

  return (
    <div>
      <Button variant="ghost" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
        <HugeiconsIcon icon={LogoutIcon} aria-hidden="true" />
        {signOut.isPending ? "Saindo…" : "Sair"}
      </Button>
      {signOut.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {signOutError}
        </p>
      ) : null}
    </div>
  );
}

export function PortalSidebarUser({ principal }: { principal: PortalPrincipal }) {
  const ability = createPortalAbility(principal.role);

  return (
    <SidebarUser name={principal.name} label={roleLabels[principal.role]} signInPath="/entrar">
      {ability.can("manage", "Team") ? (
        <SidebarUserItem link={<Link to="/equipe" />} icon={UserAccountIcon}>
          Equipe
        </SidebarUserItem>
      ) : null}
      {ability.can("manage", "Integrations") ? (
        <SidebarUserItem link={<Link to="/planos-e-gastos" />} icon={CreditCardIcon}>
          Planos e gastos
        </SidebarUserItem>
      ) : null}
    </SidebarUser>
  );
}

export function SidebarUser({
  name,
  label,
  signInPath,
  children,
}: {
  name: string;
  label: string;
  signInPath: SignInPath;
  children?: ReactNode;
}) {
  const { isMobile } = useSidebar();
  const signOut = usePortalSignOut(signInPath);

  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return (
    <SidebarFooter className="border-t border-sidebar-border">
      {signOut.isError && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {signOutError}
        </p>
      )}
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Menu de usuário de ${name}`}
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
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{label}</span>
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
                  {name}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {children}
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

export function SidebarUserItem({
  link,
  icon,
  children,
}: {
  link: ComponentProps<typeof DropdownMenuItem>["render"];
  icon: ComponentProps<typeof HugeiconsIcon>["icon"];
  children: ReactNode;
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <DropdownMenuItem render={link} onClick={() => setOpenMobile(false)}>
      <HugeiconsIcon icon={icon} aria-hidden="true" />
      {children}
    </DropdownMenuItem>
  );
}
