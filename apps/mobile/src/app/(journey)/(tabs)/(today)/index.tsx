import { useAuth } from "../../../../features/auth/session";
import { useCareerData } from "../../../../features/career/data";
import { applicationCounts } from "../../../../features/career/model";
import { HomeScreen } from "../../../../features/departure/home-screen";

export default function HomeRoute() {
  const { session } = useAuth();
  const [career, , storage] = useCareerData();

  const activity =
    storage.loading || storage.readFailed ? undefined : applicationCounts(career.applications);

  return session.status === "signed-in" ? (
    <HomeScreen name={session.account.name} activity={activity} />
  ) : null;
}
