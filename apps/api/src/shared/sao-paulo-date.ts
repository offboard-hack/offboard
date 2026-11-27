const saoPauloOffsetMs = 3 * 60 * 60_000;

export function saoPauloDate(now: Date) {
  return new Date(now.getTime() - saoPauloOffsetMs).toISOString().slice(0, 10);
}

export function saoPauloDayStart(now: Date) {
  return new Date(Date.parse(`${saoPauloDate(now)}T00:00:00Z`) + saoPauloOffsetMs);
}

export function addMonths(date: string, months: number) {
  const result = new Date(`${date}T00:00:00Z`);
  const day = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + months);

  if (result.getUTCDate() !== day) result.setUTCDate(0);

  return result.toISOString().slice(0, 10);
}
