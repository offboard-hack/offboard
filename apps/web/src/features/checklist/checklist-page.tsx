import * as stylex from "@stylexjs/stylex";
import { Switch } from "@base-ui/react/switch";
import { useState } from "react";
import { portalStyles } from "../../shared/ui/surface.styles";
import { colors, motion } from "../../shared/ui/theme.stylex";

const stacked = "@media (max-width: 52rem)";
const short = "@media (max-width: 37rem)";

const styles = stylex.create({
  metric: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
    paddingBlockStart: "0.625rem",
  },
  metricValue: {
    margin: "0.25rem 0 0",
    fontSize: "1.5rem",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  muted: { fontSize: "0.875rem", color: colors.muted, lineHeight: 1.5, margin: 0 },
  columns: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1.35fr) minmax(0, 1fr)", [stacked]: "1fr" },
    alignItems: "start",
    gap: "1rem",
  },
  panelTitle: { padding: "1rem", margin: 0 },
  list: { listStyle: "none", padding: 0, margin: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  badge: {
    flexShrink: 0,
    borderRadius: "99px",
    padding: "0.25rem 0.625rem",
    backgroundColor: colors.lavenderSoft,
    color: colors.brand,
    fontSize: "0.75rem",
    fontWeight: 650,
  },
  deadline: {
    display: "grid",
    alignContent: "start",
    gap: "0.25rem",
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
    paddingBlock: "0.5rem",
    fontSize: "0.875rem",
  },
  ruleText: {
    display: "grid",
    gap: "0.25rem",
    fontSize: "0.875rem",
  },
  ruleTiming: { color: colors.brand, fontSize: "0.75rem", fontWeight: 550 },
  switchControl: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    padding: 0,
    width: "2.75rem",
    height: "2.75rem",
    borderWidth: 0,
    borderRadius: "0.5rem",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  switchTrack: {
    display: "flex",
    alignItems: "center",
    width: "2.25rem",
    height: "1.375rem",
    borderRadius: "99px",
    backgroundColor: colors.muted,
    padding: "0.125rem",
    transitionProperty: "background-color",
    transitionDuration: motion.feedback,
  },
  switchTrackOn: { backgroundColor: colors.brand },
  switchThumb: {
    width: "1.125rem",
    height: "1.125rem",
    borderRadius: "99px",
    backgroundColor: colors.surface,
    transitionProperty: {
      default: null,
      "@media (prefers-reduced-motion: no-preference)": "transform",
    },
    transitionDuration: motion.popup,
    transitionTimingFunction: motion.easeOut,
  },
  switchThumbOn: { transform: "translateX(0.875rem)" },
  preview: { alignSelf: "start" },
  previewContent: { display: "grid", gap: "0.875rem", padding: "0 1rem 1rem" },
  previewMetrics: {
    display: "grid",
    gridTemplateColumns: { default: "1fr 1fr", [short]: "1fr" },
    margin: 0,
    gap: "0.5rem",
  },
  timelineTitle: { fontSize: "0.875rem" },
  timeline: { display: "grid", gap: "0.375rem" },
});

const baseRule = {
  title: "Aplicar o modelo base da CLT",
  description: "Aviso prévio, exame demissional, rescisão, eSocial, FGTS e benefícios.",
  team: "RH e DP",
  timing: "A partir do dia 0",
};

const optionalRules = [
  {
    id: "remote",
    title: "Agendar coleta em casa",
    description: "A pessoa escolhe o horário pelo app quando trabalha remotamente.",
    team: "TI",
    timing: "Dias 1 a 7",
  },
  {
    id: "assets",
    title: "Conferir o inventário de TI",
    description: "Registrar os bens e acompanhar a devolução ao estoque.",
    team: "TI",
    timing: "Dias 1 a 7",
  },
  {
    id: "crm",
    title: "Transferir negócios e contatos",
    description: "Passar os registros no CRM para quem a gestão indicar.",
    team: "Gestão",
    timing: "Dias 1 a 7",
  },
  {
    id: "workspace",
    title: "Encerrar acesso ao Google Workspace",
    description: "Bloquear o acesso e transferir os arquivos.",
    team: "TI",
    timing: "Dia 0",
  },
  {
    id: "card",
    title: "Conciliar despesas e cancelar o cartão",
    description: "Aplicável a quem tem cartão corporativo.",
    team: "Financeiro",
    timing: "Dias 1 a 7",
  },
  {
    id: "certificates",
    title: "Revisar procurações e certificados",
    description: "Verificar quais autorizações precisam ser revogadas.",
    team: "Jurídico",
    timing: "Antes da comunicação",
  },
  {
    id: "stability",
    title: "Revisar estabilidade",
    description: "Encaminhar casos sinalizados para análise do Jurídico.",
    team: "Jurídico",
    timing: "Antes da comunicação",
  },
  {
    id: "collective",
    title: "Analisar desligamentos coletivos",
    description: "Acionar o Jurídico quando o volume exigir avaliação.",
    team: "Jurídico",
    timing: "Antes da comunicação",
  },
];

export function ChecklistRulesPage() {
  const [enabledRules, setEnabledRules] = useState(
    () => new Set(optionalRules.map((rule) => rule.id)),
  );

  const activeRules = optionalRules.filter((rule) => enabledRules.has(rule.id));
  const teamCount = new Set([baseRule.team, ...activeRules.map((rule) => rule.team)]).size;

  return (
    <>
      <header {...stylex.props(portalStyles.pageHeader)}>
        <div>
          <h1 id="titulo-pagina" tabIndex={-1} {...stylex.props(portalStyles.heading)}>
            Checklist automático
          </h1>
          <p {...stylex.props(portalStyles.description)}>
            Simule as regras que complementam o checklist de desligamento.
          </p>
        </div>
      </header>

      <div {...stylex.props(styles.columns)}>
        <section aria-labelledby="rules-title" {...stylex.props(portalStyles.panel)}>
          <h2 id="rules-title" {...stylex.props(portalStyles.subheading, styles.panelTitle)}>
            Regras do checklist
          </h2>
          <ul {...stylex.props(styles.list)}>
            <li {...stylex.props(styles.row)}>
              <div {...stylex.props(styles.ruleText)}>
                <h3>{baseRule.title}</h3>
                <p {...stylex.props(styles.muted)}>{baseRule.description}</p>
                <p {...stylex.props(styles.ruleTiming)}>
                  {baseRule.team} · {baseRule.timing}
                </p>
              </div>
              <span {...stylex.props(styles.badge)}>Obrigatória</span>
            </li>
            {optionalRules.map((rule) => {
              const enabled = enabledRules.has(rule.id);

              return (
                <li key={rule.id} {...stylex.props(styles.row)}>
                  <div {...stylex.props(styles.ruleText)}>
                    <h3>
                      <label htmlFor={`rule-${rule.id}`}>{rule.title}</label>
                    </h3>
                    <p id={`rule-detail-${rule.id}`} {...stylex.props(styles.muted)}>
                      {rule.description}
                    </p>
                    <p {...stylex.props(styles.ruleTiming)}>
                      {rule.team} · {rule.timing}
                    </p>
                  </div>
                  <Switch.Root
                    id={`rule-${rule.id}`}
                    aria-describedby={`rule-detail-${rule.id}`}
                    checked={enabled}
                    nativeButton
                    render={<button type="button" />}
                    onCheckedChange={(checked) => {
                      setEnabledRules((current) => {
                        const next = new Set(current);

                        if (checked) {
                          next.add(rule.id);
                        } else {
                          next.delete(rule.id);
                        }

                        return next;
                      });
                    }}
                    {...stylex.props(styles.switchControl)}
                  >
                    <span {...stylex.props(styles.switchTrack, enabled && styles.switchTrackOn)}>
                      <Switch.Thumb
                        {...stylex.props(styles.switchThumb, enabled && styles.switchThumbOn)}
                      />
                    </span>
                  </Switch.Root>
                </li>
              );
            })}
          </ul>
        </section>

        <section
          aria-labelledby="preview-title"
          {...stylex.props(portalStyles.panel, styles.preview)}
        >
          <h2 id="preview-title" {...stylex.props(portalStyles.subheading, styles.panelTitle)}>
            Prévia da simulação
          </h2>
          <div {...stylex.props(styles.previewContent)}>
            <p {...stylex.props(styles.muted)}>
              As alterações valem para esta prévia e não são salvas.
            </p>
            <dl aria-live="polite" {...stylex.props(styles.previewMetrics)}>
              <div {...stylex.props(styles.metric)}>
                <dt {...stylex.props(styles.muted)}>Regras aplicadas</dt>
                <dd {...stylex.props(styles.metricValue)}>{activeRules.length + 1}</dd>
              </div>
              <div {...stylex.props(styles.metric)}>
                <dt {...stylex.props(styles.muted)}>Áreas envolvidas</dt>
                <dd {...stylex.props(styles.metricValue)}>{teamCount}</dd>
              </div>
            </dl>
            <h3 {...stylex.props(styles.timelineTitle)}>Prazos do checklist</h3>
            <ul {...stylex.props(styles.list, styles.timeline)}>
              <li {...stylex.props(styles.deadline)}>
                <strong>{baseRule.timing}</strong>
                <span>{baseRule.title}</span>
              </li>
              {activeRules.map((rule) => (
                <li key={rule.id} {...stylex.props(styles.deadline)}>
                  <strong>{rule.timing}</strong>
                  <span>{rule.title}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
