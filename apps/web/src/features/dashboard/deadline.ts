export type DeadlineGroup = "overdue" | "today" | "upcoming";

export const deadlineGroups: DeadlineGroup[] = ["overdue", "today", "upcoming"];

export const deadlineLabels = {
  overdue: "Em atraso",
  today: "Vencem hoje",
  upcoming: "Próximos",
} satisfies Record<DeadlineGroup, string>;
