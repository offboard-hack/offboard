const saoPauloOffsetMs = 3 * 60 * 60_000;

export function saoPauloDate(now: Date) {
  return new Date(now.getTime() - saoPauloOffsetMs).toISOString().slice(0, 10);
}

export function saoPauloDayStart(now: Date) {
  return new Date(Date.parse(`${saoPauloDate(now)}T00:00:00Z`) + saoPauloOffsetMs);
}
