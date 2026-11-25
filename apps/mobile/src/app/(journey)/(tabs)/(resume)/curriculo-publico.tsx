import { useAuth } from "../../../../features/auth/session";
import { ResumePublicScreen } from "../../../../features/career/resume-screen";

export default function ResumePreviewRoute() {
  const { session } = useAuth();

  return session.status === "signed-in" ? <ResumePublicScreen name={session.account.name} /> : null;
}
