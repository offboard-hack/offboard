export const resumeRefreshMs = 3_000;

export const jobsRefreshMs = 20_000;

export function resumeRefetchInterval(data: { score: number | null } | null | undefined) {
  return data && data.score === null ? resumeRefreshMs : false;
}

export function jobsRefetchInterval(
  data: { items: { match: unknown }[] } | undefined,
  hasResume: boolean,
) {
  if (!hasResume || !data) return false;

  return data.items.every((job) => job.match === null) ? jobsRefreshMs : false;
}

export function scoreArrived(previous: number | null | undefined, current: number | null) {
  return previous === null && current !== null;
}
