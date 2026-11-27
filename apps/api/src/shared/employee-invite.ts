export type AccessGranted = (orgId: string, caseId: string) => Promise<void>;

export type InviteEmployee = (
  orgId: string,
  caseId: string,
) => Promise<"sent" | "missing-case" | "no-email" | "rate-limited" | "failed">;
