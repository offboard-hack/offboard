import { useListPagination } from "@/shared/lib/use-list-pagination";
import { getRouteApi } from "@tanstack/react-router";
import { Alert02Icon, Calendar03Icon, Tick02Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { classProps } from "../../shared/lib/class-props";
import { Input } from "@/shared/ui/shadcn/input";
import { useState } from "react";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles as s } from "../../shared/ui/surface.styles";

const styles = {
  accessTable: "min-w-lg",
  notice: "text-sm text-muted-foreground",
  input: "w-full max-w-sm",
};

const beneficiaries = [
  { name: "Marina Lopes", plan: "Gold", status: "Ativo", until: "30 abr" },
  { name: "Lucas Almeida", plan: "Silver", status: "Convidado", until: "Após ativação" },
  { name: "Renata Souza", plan: "Platinum", status: "Ativo", until: "22 abr" },
  { name: "Pedro Santos", plan: "Gold", status: "Ativo", until: "31 mar" },
  { name: "Carla Mendes", plan: "Silver", status: "Expirado", until: "31 out" },
];

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

const beneficiaryColumns: TableColumn<(typeof beneficiaries)[number]>[] = [
  {
    id: "name",
    accessorFn: ({ name }) => name,
    header: "Pessoa",
    enableSorting: true,
    sortFn: "portugueseText",
  },
  { id: "plan", accessorFn: ({ plan }) => plan, header: "Plano" },
  { id: "until", accessorFn: ({ until }) => until, header: "Fim do acesso" },
  { id: "status", accessorFn: ({ status }) => status, header: "Status" },
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

  const updatePagination: Parameters<typeof useListPagination>[0] = (patch) => {
    void navigate({
      search: (previous) => ({ ...previous, ...patch }),
      resetScroll: false,
    });
  };

  const urlPagination = useListPagination(updatePagination);
  const teamPagination = useListPagination(updatePagination, "team");
  const { page } = route.useSearch();

  const [search, setSearch] = useState("");
  const term = search.trim().toLocaleLowerCase("pt-BR");

  const matching = beneficiaries.filter(({ name }) =>
    name.toLocaleLowerCase("pt-BR").includes(term),
  );

  return (
    <ListPage
      title="Acessos ao app"
      breadcrumb={<ListBreadcrumb title="Acessos ao app" />}
      metrics={[
        {
          label: "Beneficiários na amostra",
          value: beneficiaries.length,
          icon: UserGroupIcon,
          tone: "primary",
        },
        {
          label: "Ativos",
          value: beneficiaries.filter(({ status }) => status === "Ativo").length,
          icon: Tick02Icon,
          tone: "success",
        },
        {
          label: "Convites pendentes",
          value: beneficiaries.filter(({ status }) => status === "Convidado").length,
          icon: Calendar03Icon,
          tone: "warning",
        },
        {
          label: "Expirados",
          value: beneficiaries.filter(({ status }) => status === "Expirado").length,
          icon: Alert02Icon,
          tone: "danger",
        },
      ]}
    >
      <section className="min-w-0" aria-labelledby="beneficiarios">
        <p className="sr-only" role="status">
          {matching.length === 1 ? "1 resultado" : `${matching.length} resultados`}
        </p>
        <DataTable
          urlPagination={urlPagination}
          toolbar={
            <>
              <h2 {...classProps(s.subheading, "mr-2 w-full sm:w-auto")} id="beneficiarios">
                Beneficiários
              </h2>
              <Input
                type="search"
                aria-label="Buscar beneficiários por nome"
                placeholder="Buscar por nome"
                value={search}
                onChange={(event) => {
                  setSearch(event.currentTarget.value);

                  if (page) {
                    void navigate({
                      search: (previous) => ({ ...previous, page: undefined }),
                      replace: true,
                      resetScroll: false,
                    });
                  }
                }}
                {...classProps(styles.input)}
              />
            </>
          }
          data={matching}
          columns={beneficiaryColumns}
          labelledBy="beneficiarios"
          scrollLabel="Tabela de beneficiários"
          tableStyle={styles.accessTable}
          getRowId={(person) => person.name}
          emptyText="Nenhum beneficiário encontrado."
        />
      </section>
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
        Esta área mostra apenas cadastros e permissões. A jornada individual no app é privada.
      </p>
    </ListPage>
  );
}
