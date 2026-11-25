import { useAuth } from "../../../../features/auth/session";
import { ResumeScreen } from "../../../../features/career/resume-screen";

export default function ResumeRoute() {
  const { session } = useAuth();

  return session.status === "signed-in" ? <ResumeScreen name={session.account.name} /> : null;
}
