import * as stylex from "@stylexjs/stylex";

export const colors = stylex.defineVars({
  brand: "#7a12d9",
  brandHover: "#6509bb",
  ink: "#1c0f2e",
  muted: "#6b5e80",
  lavender: "#e8d9fb",
  lavenderSoft: "#f3eafd",
  border: "#e5dcee",
  controlBorder: "#8c7b9e",
  surface: "#fff",
  sidebar: "#fbf8fe",
  canvas: "#fff",
  wash: "#f7f2fc",
  overlay: "rgb(28 15 46 / 36%)",
  successInk: "#18634b",
  successSurface: "#e0f5eb",
  infoInk: "#23538c",
  infoSurface: "#e5effd",
  dangerInk: "#892e2e",
  dangerSurface: "#fceaea",
  warningInk: "#75460d",
  warningSurface: "#fff2df",
});

export const motion = stylex.defineVars({
  feedback: "120ms",
  popup: "160ms",
  drawer: "250ms",
  easeOut: "cubic-bezier(0.2, 0.7, 0.25, 1)",
});

export const elevation = stylex.defineVars({
  workSurface: "0 1px 3px rgb(28 15 46 / 12%), 0 6px 20px rgb(28 15 46 / 8%)",
  primaryControl: "0 2px 5px rgb(101 9 187 / 23%)",
  popup: "0 4px 16px rgb(28 15 46 / 13%)",
  drawer: "8px 0 36px rgb(28 15 46 / 16%)",
});

export const typeScale = stylex.defineVars({
  section: "1.25rem",
  body: "0.875rem",
  caption: "0.8125rem",
});
