export type InviteEmployee = (
  orgId: string,
  caseId: string,
) => Promise<"sent" | "missing-case" | "no-email" | "failed">;
