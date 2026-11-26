import { companySponsors } from "./entitlement.js";

export const aiApplyConsentVersion = "2026-11-25";

export const topPlanSlug = "platinum-premium";

export type CompanyPlan = { slug: string; status: string };

export function onTopPlan(plan: CompanyPlan | null) {
  return plan !== null && plan.slug === topPlanSlug && companySponsors(plan.status);
}

export function aiApplyAccess(
  profile: { aiApplyConsentAt: string | null },
  plan: CompanyPlan | null,
) {
  return profile.aiApplyConsentAt !== null && onTopPlan(plan)
    ? ("allowed" as const)
    : ("not_allowed" as const);
}

export const greenhouseKey = /^([a-z0-9][a-z0-9_-]*):(\d+)$/;

export function aiApplyCapable(job: { source: string; sourceKey: string; closedAt: Date | null }) {
  return job.closedAt === null && job.source === "greenhouse" && greenhouseKey.test(job.sourceKey);
}

export function browserbaseConfig(apiKey: string | undefined, projectId: string | undefined) {
  return apiKey && projectId ? { apiKey, projectId } : undefined;
}
