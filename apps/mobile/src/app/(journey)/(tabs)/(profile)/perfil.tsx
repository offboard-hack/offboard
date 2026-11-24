import { useAuth } from "../../../../features/auth/session";
import { ProfileScreen } from "../../../../features/privacy/profile-screen";

export default function ProfileRoute() {
  const { session, signOut } = useAuth();

  return session.status === "signed-in" ? (
    <ProfileScreen account={session.account} signOut={signOut} />
  ) : null;
}
