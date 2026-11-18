import * as stylex from "@stylexjs/stylex";
import { colors } from "../../shared/ui/theme.stylex";

const compact = "@media (max-width: 52rem)";
const mobile = "@media (max-width: 37rem)";
const panelGutter = "clamp(0.875rem, 2vw, 1.5rem)";

export const offboardingStyles = stylex.create({
  deadline: {
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
    paddingLeft: "1rem",
  },
  deadlineLabel: {
    color: colors.muted,
    fontSize: "0.8125rem",
  },
  deadlineValue: {
    marginTop: "0.25rem",
    fontSize: "1.25rem",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 650,
  },
  departmentMobile: {
    display: { default: "none", [mobile]: "block" },
  },
  departmentColumn: {
    display: { default: null, [mobile]: "none" },
  },
  caseCell: {
    paddingInline: { default: null, [mobile]: "0.75rem" },
  },
  caseLink: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: { default: "1.625rem", [compact]: "2.75rem" },
    textUnderlineOffset: "0.2em",
    color: colors.brand,
  },
  caseRow: {
    backgroundColor: { default: null, ":focus-within": colors.wash, ":hover": colors.wash },
  },
  taskProgress: {
    display: "flex",
    alignItems: { default: "center", [mobile]: "start" },
    flexDirection: { default: "row", [mobile]: "column" },
    flexWrap: "wrap",
    gap: "0.5rem 0.75rem",
    minWidth: "max-content",
    fontSize: "0.8125rem",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  progressBar: {
    width: "clamp(3rem, 7vw, 6rem)",
  },
  taskGroup: {
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  taskGroupHeading: {
    padding: `0.75rem ${panelGutter}`,
    backgroundColor: colors.wash,
    color: colors.muted,
    fontSize: "0.8125rem",
  },
  taskList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  taskRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "start",
    gap: "1rem",
    padding: `0.875rem ${panelGutter}`,
    fontSize: "0.875rem",
    lineHeight: 1.45,
    borderTopWidth: { default: "0", ":not(:first-child)": "1px" },
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  taskStatus: {
    flexShrink: 0,
    borderRadius: "0.25rem",
    padding: "0.2rem 0.5rem",
    backgroundColor: colors.wash,
    color: colors.muted,
    fontSize: "0.75rem",
    fontWeight: 600,
  },
  taskStatusInProgress: {
    color: colors.brand,
    backgroundColor: colors.lavenderSoft,
  },
  taskStatusDone: {
    color: colors.successInk,
    backgroundColor: colors.successSurface,
  },
});
