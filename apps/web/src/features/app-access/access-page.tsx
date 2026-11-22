import { useListPagination } from "@/shared/lib/use-list-pagination";
import { getRouteApi } from "@tanstack/react-router";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { classProps } from "../../shared/lib/class-props";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles as s } from "../../shared/ui/surface.styles";

const styles = {
  accessTable: "min-w-lg",
  notice: "text-sm text-muted-foreground",
};

const team = [
  { name: "Beatriz Castro", role: "Admin", access: "Áreas administrativas", security: "2FA ativo" },
  { name: "Camila Rocha", role: "Analista", access: "Cadastro e painel", security: "2FA ativo" },
  {
    name: "Diego Alves",
    role: "Financeiro",
    access: "Gastos e faturas",
    security: "Convite pendente",
  },
];

const teamColumns: TableColumn<(typeof team)[number]>[] = [
  { id: "name", accessorFn: ({ name }) => name, header: "Membro" },
  { id: "role", accessorFn: ({ role }) => role, header: "Papel" },
  { id: "access", accessorFn: ({ access }) => access, header: "Permissão" },
  { id: "security", accessorFn: ({ security }) => security, header: "Segurança" },
];

const route = getRouteApi("/acessos-ao-app");

export function AccessPage() {
  const navigate = route.useNavigate();

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
          urlPagination={teamPagination}
          data={team}
          columns={teamColumns}
          labelledBy="equipe"
          scrollLabel="Tabela da equipe de RH"
          tableStyle={styles.accessTable}
          getRowId={(member) => member.name}
        />
      </section>
      <p {...classProps(styles.notice)}>
        Esta área mostra apenas permissões. A jornada individual no app é privada.
      </p>
    </ListPage>
  );
}
