import { Delete02Icon, HelpCircleIcon } from "@hugeicons/core-free-icons";
import { Shield01Icon, UserGroupIcon, UserCheck01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  createTeamMember,
  deleteTeamMember,
  updateTeamMemberRole,
  teamQuery,
} from "@/entities/team";
import type { MemberRole, TeamMember } from "@/entities/team";
import { listPagination } from "@/shared/lib/list-pagination";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { PortalFilter } from "@/shared/ui/select";
import { Button } from "@/shared/ui/shadcn/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/shadcn/popover";
import { classProps } from "../../shared/lib/class-props";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles as s } from "../../shared/ui/surface.styles";
import { AddMemberDialog } from "./add-member-dialog";
import type { NewMember } from "./add-member-dialog";

const styles = {
  accessTable: "min-w-lg",
};

const roleDetails = {
  admin: { label: "Admin", access: "Acesso total" },
  rh: { label: "RH", access: "Operação de desligamentos" },
  gestor: { label: "Gestor", access: "Somente leitura" },
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
    capabilities: "Cria, importa e acompanha desligamentos, atualiza tarefas e subtarefas",
  },
  {
    role: "gestor",
    label: "Gestor",
    icon: UserCheck01Icon,
    tone: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
    capabilities: "Consulta desligamentos e tarefas",
  },
  {
    role: "visualizador",
    label: "Visualizador",
    icon: ViewIcon,
    tone: "bg-muted text-muted-foreground",
    capabilities: "Consulta andamento dos desligamentos (somente leitura)",
  },
];

const roleItems: { value: MemberRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "rh", label: "RH" },
  { value: "gestor", label: "Gestor" },
  { value: "visualizador", label: "Visualizador" },
];

const route = getRouteApi("/_portal/equipe");
const portalRoute = getRouteApi("/_portal");

export function AccessPage() {
  const navigate = route.useNavigate();
  const client = useQueryClient();
  const { data: team } = useSuspenseQuery(teamQuery);
  const { principal } = portalRoute.useRouteContext();

  const refresh = () => client.invalidateQueries(teamQuery);

  const add = useMutation({ mutationFn: createTeamMember, onSettled: refresh });

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: MemberRole }) => updateTeamMemberRole(id, role),
    onSettled: refresh,
  });

  const remove = useMutation({ mutationFn: deleteTeamMember, onSettled: refresh });

  async function addMember({ name, email, role }: NewMember) {
    await add.mutateAsync({ name, email, role: roleByLabel[role] });
    remove.reset();
  }

  const teamColumns: TableColumn<TeamMember>[] = [
    { id: "name", accessorFn: ({ name }) => name, header: "Membro" },
    { id: "email", accessorFn: ({ email }) => email, header: "E-mail" },
    {
      id: "role",
      accessorFn: ({ role }) => roleDetails[role].label,
      header: "Papel",
      cell: ({ row }) => {
        const member = row.original;
        const isSelf = member.id === principal.id;

        return (
          <PortalFilter
            label={`Papel de ${member.name}`}
            value={member.role}
            items={roleItems}
            onChange={(next) => {
              const selected = roleItems.find((item) => item.value === next);

              if (selected) updateRole.mutate({ id: member.id, role: selected.value });
            }}
            disabled={isSelf || updateRole.isPending}
          />
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

  const teamPagination = listPagination(
    route.useSearch(),
    (patch) =>
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        resetScroll: false,
      }),
  );

  return (
    <ListPage
      title="Equipe e permissões"
      breadcrumb={<ListBreadcrumb title="Equipe e permissões" />}
    >
      <section className="min-w-0" aria-labelledby="equipe">
        {updateRole.isError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            Não foi possível alterar o papel. Atualize a página e tente novamente.
          </p>
        )}
        {remove.isError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            Não foi possível remover o acesso. Atualize a página e tente novamente.
          </p>
        )}
        <DataTable
          toolbar={
            <div className="flex items-center gap-2">
              <h2 {...classProps(s.subheading)} id="equipe">
                Equipe RH e permissões
              </h2>
              <Popover>
                <PopoverTrigger
                  className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Ver papéis e permissões"
                >
                  <HugeiconsIcon icon={HelpCircleIcon} size={16} />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80">
                  <ul className="flex flex-col gap-3">
                    {roleCards.map(({ label, icon, tone, capabilities }) => (
                      <li key={label} className="flex items-start gap-2 text-sm">
                        <span
                          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded ${tone}`}
                        >
                          <HugeiconsIcon icon={icon} size={12} />
                        </span>
                        <div>
                          <span className="font-medium">{label}</span>
                          <span className="text-muted-foreground"> — {capabilities}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
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
