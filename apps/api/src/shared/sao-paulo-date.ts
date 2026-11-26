const saoPauloOffsetMs = 3 * 60 * 60_000;

export function saoPauloDate(now: Date) {
  return new Date(now.getTime() - saoPauloOffsetMs).toISOString().slice(0, 10);
}
