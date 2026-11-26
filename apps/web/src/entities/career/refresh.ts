export const resumeRefreshMs = 3_000;

export const jobsRefreshMs = 20_000;

export function resumeRefetchInterval(data: { scoredAt: string | null } | null | undefined) {
  return data && data.scoredAt === null ? resumeRefreshMs : false;
}

export function jobsRefetchInterval(data: { matching: boolean } | undefined, hasResume: boolean) {
  return hasResume && data?.matching ? jobsRefreshMs : false;
}

export function scoreArrived(previous: string | null | undefined, current: string | null) {
  return previous === null && current !== null;
}
