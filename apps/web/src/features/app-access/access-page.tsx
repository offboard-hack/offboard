import { useState } from "react";
import { Shield01Icon, UserGroupIcon, UserCheck01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useListPagination } from "@/shared/lib/use-list-pagination";
import { getRouteApi } from "@tanstack/react-router";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
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

const roleAccess = {
  Admin: "Acesso total",
  RH: "Cadastro e painel",
  Gestor: "Equipe e aprovações",
  Visualizador: "Somente leitura",
};

const roleCards = [
  {
    role: "Admin",
    icon: Shield01Icon,
    tone: "bg-primary/10 text-primary",
    capabilities: "Gerencia equipe, configura integrações, acessa todos os desligamentos",
  },
  {
    role: "RH",
    icon: UserGroupIcon,
    tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
    capabilities: "Cria e acompanha desligamentos, executa checklist, envia comunicações",
  },
  {
    role: "Gestor",
    icon: UserCheck01Icon,
    tone: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
    capabilities: "Acompanha equipe, aprova tarefas, recebe notificações",
  },
  {
    role: "Visualizador",
    icon: ViewIcon,
    tone: "bg-muted text-muted-foreground",
    capabilities: "Consulta andamento dos desligamentos (somente leitura)",
  },
];

const roleBadges = {
  Admin: { variant: "default", className: "" },
  RH: { variant: "secondary", className: "" },
  Gestor: { variant: "outline", className: "" },
  Visualizador: { variant: "ghost", className: "bg-muted text-muted-foreground" },
} as const;

type Member = { name: string; role: NewMember["role"]; access: string; security: string };

const initialTeam: Member[] = [
  { name: "Beatriz Castro", role: "Admin", access: roleAccess.Admin, security: "2FA ativo" },
  { name: "Camila Rocha", role: "RH", access: roleAccess.RH, security: "2FA ativo" },
  {
    name: "Diego Alves",
    role: "Gestor",
    access: roleAccess.Gestor,
    security: "Convite pendente",
  },
];

const teamColumns: TableColumn<Member>[] = [
  { id: "name", accessorFn: ({ name }) => name, header: "Membro" },
  {
    id: "role",
    accessorFn: ({ role }) => role,
    header: "Papel",
    cell: ({ row }) => {
      const { variant, className } = roleBadges[row.original.role];

      return (
        <Badge variant={variant} className={className}>
          {row.original.role}
        </Badge>
      );
    },
  },
  { id: "access", accessorFn: ({ access }) => access, header: "Permissão" },
  { id: "security", accessorFn: ({ security }) => security, header: "Segurança" },
];

const route = getRouteApi("/acessos-ao-app");

export function AccessPage() {
  const navigate = route.useNavigate();
  const [team, setTeam] = useState(initialTeam);

  const addMember = ({ name, email, role }: NewMember) =>
    setTeam((current) => [
      ...current,
      { name, role, access: roleAccess[role], security: `Convite pendente (${email})` },
    ]);

  const teamPagination = useListPagination(
    (patch) =>
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        resetScroll: false,
      }),
  );

  const roleSummary = roleCards
    .map(({ role }) => `${team.filter((member) => member.role === role).length} ${role}`)
    .join(" · ");

  return (
    <ListPage
      title="Equipe e permissões"
      breadcrumb={<ListBreadcrumb title="Equipe e permissões" />}
    >
      <section className="grid min-w-0 gap-3 sm:grid-cols-2" aria-label="Capacidades por papel">
        {roleCards.map(({ role, icon, tone, capabilities }) => (
          <Card key={role}>
            <CardHeader className="flex-row items-center gap-3">
              <span className={`flex size-8 items-center justify-center rounded-lg ${tone}`}>
                <HugeiconsIcon icon={icon} size={16} />
              </span>
              <CardTitle>{role}</CardTitle>
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
          getRowId={(member) => member.name}
        />
      </section>
    </ListPage>
  );
}
