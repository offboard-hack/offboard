import type { GenerateStructured } from "../../shared/ai.js";
import { errorSummary } from "../../shared/error-summary.js";
import type { JobShareFailure } from "../../shared/job-share.js";
import { parsePublicUrl, type FetchPageResult } from "../../shared/page-text.js";
import { extractJob, normalizeJobUrl } from "./extract.js";
import { shareSources, type JobsRepository } from "./repository.js";

export type ShareJobDeps = {
  repos: Pick<JobsRepository, "findBySource" | "createShared">;
  generate: GenerateStructured | undefined;
  fetchPage: (url: URL) => Promise<FetchPageResult>;
};

const failed = (kind: JobShareFailure) => ({ kind });

export async function shareJob(
  deps: ShareJobDeps,
  input: { url: string; origin: "hr" | "recruiter"; recruiterPartnerId?: string },
) {
  const parsed = parsePublicUrl(input.url);

  if (parsed === "invalid_url") return failed("invalid_url");

  const sourceKey = normalizeJobUrl(parsed);

  if (sourceKey.length > 2048) return failed("invalid_url");

  const existing = await deps.repos.findBySource(shareSources[input.origin], sourceKey);

  if (existing) return { kind: "existing", job: existing } as const;

  if (!deps.generate) return failed("ai_unavailable");

  const page = await deps.fetchPage(parsed);

  if (page === "invalid_url") return failed("invalid_url");

  if (page === "unreachable" || page === "not_html" || page === "too_large") {
    return failed("unreadable");
  }

  let draft;

  try {
    draft = await extractJob(deps.generate, page);
  } catch (error) {
    console.error("job extraction failed", errorSummary(error));

    return failed("extraction_failed");
  }

  if (draft === "not_a_job") return failed("not_a_job");

  const { job, created } = await deps.repos.createShared({
    ...draft,
    url: sourceKey,
    sourceKey,
    origin: input.origin,
    recruiterPartnerId: input.recruiterPartnerId,
  });

  return { kind: created ? "created" : "existing", job } as const;
}
