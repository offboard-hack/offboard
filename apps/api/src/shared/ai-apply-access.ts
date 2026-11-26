export const aiApplyConsentVersion = "2026-11-25";

function normalize(email: string) {
  return email.trim().toLowerCase();
}

export function parseAllowlist(raw: string | undefined) {
  return (raw ?? "")
    .split(",")
    .map(normalize)
    .filter((entry) => entry !== "");
}

export function aiApplyAccess(
  profile: { personalEmail: string; aiApplyConsentAt: string | null },
  allowlist: string[],
) {
  const email = normalize(profile.personalEmail);
  const listed = allowlist.some((entry) => entry.trim() !== "" && normalize(entry) === email);

  return listed && profile.aiApplyConsentAt !== null
    ? ("allowed" as const)
    : ("not_allowed" as const);
}

export function browserbaseConfig(apiKey: string | undefined, projectId: string | undefined) {
  return apiKey && projectId ? { apiKey, projectId } : undefined;
}
