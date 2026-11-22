import { Delete02Icon } from "@hugeicons/core-free-icons";
import { Shield01Icon, UserGroupIcon, UserCheck01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { createTeamMember, deleteTeamMember, teamQuery } from "@/entities/team";
import type { MemberRole, TeamMember } from "@/entities/team";
import { useListPagination } from "@/shared/lib/use-list-pagination";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { Button } from "@/shared/ui/shadcn/button";
import { classProps } from "../../shared/lib/class-props";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { Badge } from "../../shared/ui/shadcn/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/shadcn/card";
import { portalStyles as s } from "../../shared/ui/surface.styles";
import { AddMemberDialog } from "./add-member-dialog";
import type { NewMember } from "./add-member-dialog";

const styles = {
  accessTable: "min-w-lg",
};

const roleDetails = {
  admin: { label: "Admin", access: "Acesso total" },
  rh: { label: "RH", access: "Cadastro e painel" },
  gestor: { label: "Gestor", access: "Equipe e aprovações" },
  visualizador: { label: "Visualizador", access: "Somente leitura" },
} satisfies Record<MemberRole, { label: string; access: string }>;

const roleByLabel = {
  Admin: "admin",
  RH: "rh",
  Gestor: "gestor",
  Visualizador: "visualizador",
} satisfies Record<NewMember["role"], MemberRole>;

const roleCards: {
  role: MemberRole;
  label: string;
  icon: typeof Shield01Icon;
  tone: string;
  capabilities: string;
}[] = [
  {
    role: "admin",
    label: "Admin",
    icon: Shield01Icon,
    tone: "bg-primary/10 text-primary",
    capabilities: "Gerencia equipe, configura integrações, acessa todos os desligamentos",
  },
  {
    role: "rh",
    label: "RH",
    icon: UserGroupIcon,
    tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
    capabilities: "Cria e acompanha desligamentos, executa checklist, envia comunicações",
  },
  {
    role: "gestor",
    label: "Gestor",
    icon: UserCheck01Icon,
    tone: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
    capabilities: "Acompanha equipe, aprova tarefas, recebe notificações",
  },
  {
    role: "visualizador",
    label: "Visualizador",
    icon: ViewIcon,
    tone: "bg-muted text-muted-foreground",
    capabilities: "Consulta andamento dos desligamentos (somente leitura)",
  },
];

const roleBadges: Record<
  MemberRole,
  { variant: "default" | "secondary" | "outline"; className: string }
> = {
  admin: { variant: "default", className: "" },
  rh: { variant: "secondary", className: "" },
  gestor: { variant: "outline", className: "" },
  visualizador: { variant: "outline", className: "bg-muted text-muted-foreground" },
};

const route = getRouteApi("/acessos-ao-app");

export function AccessPage() {
  const navigate = route.useNavigate();
  const client = useQueryClient();
  const { data: team } = useSuspenseQuery(teamQuery);

  const refresh = () => client.invalidateQueries(teamQuery);

  const add = useMutation({ mutationFn: createTeamMember, onSettled: refresh });
  const remove = useMutation({ mutationFn: deleteTeamMember, onSettled: refresh });

  const addMember = ({ name, email, role }: NewMember) =>
    add.mutate({ name, email, role: roleByLabel[role] });

  const teamColumns: TableColumn<TeamMember>[] = [
    { id: "name", accessorFn: ({ name }) => name, header: "Membro" },
    { id: "email", accessorFn: ({ email }) => email, header: "E-mail" },
    {
      id: "role",
      accessorFn: ({ role }) => roleDetails[role].label,
      header: "Papel",
      cell: ({ row }) => {
        const { variant, className } = roleBadges[row.original.role];

        return (
          <Badge variant={variant} className={className}>
            {roleDetails[row.original.role].label}
          </Badge>
        );
      },
    },
    { id: "access", accessorFn: ({ role }) => roleDetails[role].access, header: "Permissão" },
    {
      id: "actions",
      header: "Ações",
      enableSorting: false,
      cell: ({ row: { original } }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remover ${original.name}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate(original.id)}
        >
          <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
        </Button>
      ),
    },
  ];

  const teamPagination = useListPagination(
    (patch) =>
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        resetScroll: false,
      }),
  );

  const roleSummary = roleCards
    .map(({ role, label }) => `${team.filter((member) => member.role === role).length} ${label}`)
    .join(" · ");

  return (
    <ListPage
      title="Equipe e permissões"
      breadcrumb={<ListBreadcrumb title="Equipe e permissões" />}
    >
      <section className="grid min-w-0 gap-3 sm:grid-cols-2" aria-label="Capacidades por papel">
        {roleCards.map(({ label, icon, tone, capabilities }) => (
          <Card key={label}>
            <CardHeader className="flex-row items-center gap-3">
              <span className={`flex size-8 items-center justify-center rounded-lg ${tone}`}>
                <HugeiconsIcon icon={icon} size={16} />
              </span>
              <CardTitle>{label}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{capabilities}</CardContent>
          </Card>
        ))}
      </section>

      <p className="text-sm text-muted-foreground">
        <strong className="font-semibold text-foreground">Total de membros: {team.length}</strong>
        {" · "}
        {roleSummary}
      </p>

      <section className="min-w-0" aria-labelledby="equipe">
        <DataTable
          toolbar={
            <h2 {...classProps(s.subheading)} id="equipe">
              Equipe RH e permissões
            </h2>
          }
          toolbarEnd={<AddMemberDialog onAdd={addMember} />}
          urlPagination={teamPagination}
          data={team}
          columns={teamColumns}
          labelledBy="equipe"
          scrollLabel="Tabela da equipe de RH"
          tableStyle={styles.accessTable}
          getRowId={(member) => member.id}
        />
      </section>
    </ListPage>
  );
}
