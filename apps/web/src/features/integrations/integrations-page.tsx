import * as stylex from "@stylexjs/stylex";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { integrationsQuery } from "../../shared/api";
import { PortalFilter } from "../../shared/ui/select";
import { PageHeading as ModuleHeading } from "../../shared/ui/page";
import { portalStyles } from "../../shared/ui/surface.styles";
import { colors } from "../../shared/ui/theme.stylex";

const compact = "@media (max-width: 62rem)";

const styles = stylex.create({
  toolbar: {
    paddingInline: 0,
    borderTopWidth: 0,
  },
  directory: {
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colors.border,
  },
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1.4fr) minmax(0, 1fr) 8rem",
      [compact]: "minmax(0, 1fr) auto",
    },
    columnGap: "1.25rem",
    alignItems: "center",
  },
  directoryHeading: {
    display: { default: "grid", [compact]: "none" },
    backgroundColor: colors.wash,
    padding: "0.625rem 1rem",
    color: colors.muted,
    fontSize: "0.8125rem",
    fontWeight: 650,
  },
  entry: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
    padding: "0.875rem 1rem",
    rowGap: "0.5rem",
  },
  description: { display: "grid", gap: "0.1875rem" },
  label: { color: colors.muted, fontSize: "0.8125rem", lineHeight: 1.45 },
  serviceHeading: { fontSize: "0.9375rem", lineHeight: 1.4, fontWeight: 650 },
  serviceUpdate: {
    gridRow: { default: "auto", [compact]: "2" },
    gridColumn: { default: "auto", [compact]: "1 / -1" },
  },
  status: {
    gridRow: { default: "auto", [compact]: "1" },
    gridColumn: { default: "auto", [compact]: "2" },
    justifySelf: "end",
    alignSelf: "start",
  },
  badge: {
    display: "inline-block",
    borderRadius: "1rem",
    padding: "0.25rem 0.5rem",
    color: colors.muted,
    backgroundColor: colors.wash,
    fontSize: "0.75rem",
    fontWeight: 650,
    lineHeight: 1.3,
  },
  badgeReady: {
    color: colors.successInk,
    backgroundColor: colors.successSurface,
  },
  missingActivity: { display: { default: "block", [compact]: "none" } },
});

export type Integration = { name: string; purpose: string } & (
  | { status: "connected"; update: string }
  | { status: "disconnected" }
);

const route = getRouteApi("/integracoes");

export function IntegrationsPage() {
  const { data: integrations } = useSuspenseQuery(integrationsQuery);
  const { status = "" } = route.useSearch();
  const navigate = route.useNavigate();

  const visibleIntegrations = integrations.filter(
    (integration) => !status || integration.status === status,
  );

  return (
    <>
      <ModuleHeading
        title="Integrações"
        description="Sistemas que automatizam etapas do desligamento. Os status e as atividades abaixo são ilustrativos."
      />
      <div {...stylex.props(portalStyles.filterBar, styles.toolbar)}>
        <PortalFilter
          label="Status da conexão"
          value={status}
          onChange={(next) => {
            const status = next === "connected" || next === "disconnected" ? next : undefined;

            void navigate({ search: { status }, resetScroll: false });
          }}
          items={[
            { value: "", label: "Todas as conexões" },
            { value: "connected", label: "Conectadas" },
            { value: "disconnected", label: "Não conectadas" },
          ]}
        />
        <span role="status" {...stylex.props(portalStyles.resultCount)}>
          {visibleIntegrations.length}{" "}
          {visibleIntegrations.length === 1 ? "integração" : "integrações"}
        </span>
      </div>
      <section aria-label="Sistemas integrados" {...stylex.props(styles.directory)}>
        <div aria-hidden="true" {...stylex.props(styles.columns, styles.directoryHeading)}>
          <span>Sistema</span>
          <span>Última atividade</span>
          <span {...stylex.props(styles.status)}>Conexão</span>
        </div>
        {visibleIntegrations.map((integration) => (
          <article {...stylex.props(styles.columns, styles.entry)} key={integration.name}>
            <div {...stylex.props(styles.description)}>
              <h2 {...stylex.props(styles.serviceHeading)}>{integration.name}</h2>
              <p {...stylex.props(styles.label)}>{integration.purpose}</p>
            </div>
            {integration.status === "connected" ? (
              <p {...stylex.props(styles.label, styles.serviceUpdate)}>{integration.update}</p>
            ) : (
              <span aria-hidden="true" {...stylex.props(styles.label, styles.missingActivity)}>
                —
              </span>
            )}
            <span
              {...stylex.props(
                styles.badge,
                styles.status,
                integration.status === "connected" && styles.badgeReady,
              )}
            >
              {integration.status === "connected" ? "Conectada" : "Não conectada"}
            </span>
          </article>
        ))}
      </section>
    </>
  );
}
