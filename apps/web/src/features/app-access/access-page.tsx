import { Delete02Icon } from "@hugeicons/core-free-icons";
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
    { id: "role", accessorFn: ({ role }) => roleDetails[role].label, header: "Papel" },
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

  return (
    <ListPage
      title="Equipe e permissões"
      breadcrumb={<ListBreadcrumb title="Equipe e permissões" />}
    >
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
