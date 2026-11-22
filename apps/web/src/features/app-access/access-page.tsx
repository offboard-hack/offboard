import * as stylex from "@stylexjs/stylex";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles as s } from "../../shared/ui/surface.styles";
import { colors } from "../../shared/ui/theme.stylex";

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
});

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

export function AccessPage() {
  return (
    <>
      <header {...stylex.props(s.pageHeader)}>
        <div>
          <h1 {...stylex.props(s.heading)} id="titulo-pagina" tabIndex={-1}>
            Equipe e permissões
          </h1>
          <p {...stylex.props(s.description)}>Acessos ao app e permissões do RH.</p>
        </div>
      </header>
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
        Esta área mostra apenas permissões. A jornada individual no app é privada.
      </p>
    </>
  );
}
