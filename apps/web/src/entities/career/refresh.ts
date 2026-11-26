export const resumeRefreshMs = 3_000;

export const jobsRefreshMs = 20_000;

export function resumeRefetchInterval(data: { rescoring: boolean } | null | undefined) {
  return data?.rescoring ? resumeRefreshMs : false;
}

export function jobsRefetchInterval(data: { matching: boolean } | undefined, hasResume: boolean) {
  return hasResume && data?.matching ? jobsRefreshMs : false;
}

export function scoreArrived(previous: boolean | undefined, current: boolean) {
  return previous === true && !current;
}
