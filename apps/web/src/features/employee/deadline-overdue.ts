export function isDeadlineOverdue(deadline: string, today: string) {
  return deadline < today;
}
