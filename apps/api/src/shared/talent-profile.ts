export type TalentProfile = {
  id: string;
  caseId: string | null;
  name: string;
  email: string;
  sponsoredUntil: string;
  termsAcceptedAt: string | null;
  firstSignedInAt: string | null;
  shareOutcomeWithHr: boolean;
  aiApplyConsentAt: string | null;
  aiApplyConsentVersion: string | null;
};
