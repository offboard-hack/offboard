import type { JobsView } from "@/entities/career";

export const jobsViews = [
  { value: "compatible", label: "Compatíveis" },
  { value: "all", label: "Todas as vagas" },
] as const satisfies { value: JobsView; label: string }[];

export function jobsEmpty({
  view,
  matching,
  hasResume,
  filtered,
}: {
  view: JobsView;
  matching: boolean;
  hasResume: boolean;
  filtered: boolean;
}) {
  if (view === "all") return filtered ? "no-model" : "none";

  if (matching) return "calculating";

  return hasResume ? "no-compatible" : "no-resume";
}

export function jobsSummary({
  view,
  total,
  hasResume,
}: {
  view: JobsView;
  total: number;
  hasResume: boolean;
}) {
  const count = `${total} ${total === 1 ? "vaga" : "vagas"}`;

  if (view === "compatible") return `${count} ${total === 1 ? "compatível" : "compatíveis"}.`;

  return hasResume ? `${count}, das mais compatíveis às menos.` : `${count}.`;
}
