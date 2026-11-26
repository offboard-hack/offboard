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

export function browserbaseConfig(apiKey: string | undefined, projectId: string | undefined) {
  return apiKey && projectId ? { apiKey, projectId } : undefined;
}
