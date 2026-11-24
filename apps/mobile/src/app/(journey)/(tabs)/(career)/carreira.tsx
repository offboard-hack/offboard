import { useAuth } from "../../../../features/auth/session";
import { CareerScreen } from "../../../../features/career/career-screen";

export default function CareerRoute() {
  const { session } = useAuth();

  return session.status === "signed-in" ? <CareerScreen name={session.account.name} /> : null;
}
