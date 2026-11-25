export const aiApplyConsentVersion = "2026-11-25";

export function parseAllowlist(raw: string | undefined) {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

export function aiApplyAccess(
  profile: { personalEmail: string; aiApplyConsentAt: Date | null },
  allowlist: string[],
) {
  const listed = allowlist.includes(profile.personalEmail.trim().toLowerCase());

  return listed && profile.aiApplyConsentAt !== null
    ? ("allowed" as const)
    : ("not_allowed" as const);
}
