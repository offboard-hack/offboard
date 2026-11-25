export const jobShareFailures = {
  invalid_url: { status: 422, error: "Invalid job url" },
  not_a_job: { status: 422, error: "Page is not a job posting" },
  unreadable: { status: 502, error: "Could not read the job page" },
  extraction_failed: { status: 502, error: "Could not extract the job" },
  ai_unavailable: { status: 503, error: "AI not configured" },
} as const;

export type JobShareFailure = keyof typeof jobShareFailures;
