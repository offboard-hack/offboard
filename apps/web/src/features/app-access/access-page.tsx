import * as stylex from "@stylexjs/stylex";
import { Input } from "@base-ui/react/input";
import { useState } from "react";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles as s } from "../../shared/ui/surface.styles";
import { colors } from "../../shared/ui/theme.stylex";
import { Metrics } from "../../shared/ui/page";

const styles = stylex.create({
  accessTable: { minWidth: "30rem" },
  notice: {
    backgroundColor: colors.lavenderSoft,
    borderRadius: "0.5rem",
    padding: "0.875rem 1rem",
    color: colors.muted,
    fontSize: "0.875rem",
    lineHeight: 1.5,
    marginBlock: "1rem",
  },
  tablePanel: { marginBlockStart: "1rem" },
  input: { width: "min(100%, 22rem)" },
});

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

export function AccessPage() {
  const [search, setSearch] = useState("");
  const term = search.trim().toLocaleLowerCase("pt-BR");

  const matching = beneficiaries.filter(({ name }) =>
    name.toLocaleLowerCase("pt-BR").includes(term),
  );

  return (
    <>
      <header {...stylex.props(s.pageHeader)}>
        <div>
          <h1 {...stylex.props(s.heading)} id="titulo-pagina" tabIndex={-1}>
            Beneficiários e equipe
          </h1>
          <p {...stylex.props(s.description)}>Cadastros, acessos ao app e permissões do RH.</p>
        </div>
      </header>
      <Metrics
        items={[
          { label: "Cadastros nesta amostra", value: beneficiaries.length },
          {
            label: "Ativos",
            value: beneficiaries.filter(({ status }) => status === "Ativo").length,
          },
          {
            label: "Convites pendentes",
            value: beneficiaries.filter(({ status }) => status === "Convidado").length,
          },
          {
            label: "Expirados",
            value: beneficiaries.filter(({ status }) => status === "Expirado").length,
          },
        ]}
      />
      <Input
        aria-label="Buscar beneficiários por nome"
        placeholder="Buscar por nome"
        value={search}
        onValueChange={setSearch}
        {...stylex.props(s.filterInput, styles.input)}
      />
      <section {...stylex.props(s.panel, styles.tablePanel)} aria-labelledby="beneficiarios">
        <div {...stylex.props(s.panelHeader)}>
          <h2 {...stylex.props(s.subheading)} id="beneficiarios">
            Beneficiários
          </h2>
          <span {...stylex.props(s.resultCount)} role="status">
            {matching.length === 1 ? "1 resultado" : `${matching.length} resultados`}
          </span>
        </div>
        <DataTable
          data={matching}
          columns={beneficiaryColumns}
          labelledBy="beneficiarios"
          scrollLabel="Tabela de beneficiários"
          tableStyle={styles.accessTable}
          getRowId={(person) => person.name}
          emptyText="Nenhum beneficiário encontrado."
        />
      </section>
      <section {...stylex.props(s.panel, styles.tablePanel)} aria-labelledby="equipe">
        <div {...stylex.props(s.panelHeader)}>
          <h2 {...stylex.props(s.subheading)} id="equipe">
            Equipe RH e permissões
          </h2>
        </div>
        <DataTable
          data={team}
          columns={teamColumns}
          labelledBy="equipe"
          scrollLabel="Tabela da equipe de RH"
          tableStyle={styles.accessTable}
          getRowId={(member) => member.name}
        />
      </section>
      <p {...stylex.props(styles.notice)}>
        Esta área mostra apenas cadastros e permissões. A jornada individual no app é privada.
      </p>
    </>
  );
}
