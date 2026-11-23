import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { offboardingTeams, offboardingsQuery } from "@/entities/offboarding";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { classProps } from "@/shared/lib/class-props";

const dashboardRoute = getRouteApi("/_portal/painel");

export function Dashboard() {
  const { data: cases } = useSuspenseQuery(offboardingsQuery);
  const { area = "", deadline = "all" } = dashboardRoute.useSearch();
  const navigate = dashboardRoute.useNavigate();

  return (
    <DashboardPage
      cases={cases}
      areaFilter={area}
      deadlineFilter={deadline}
      onAreaChange={(next) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            area: offboardingTeams.find((team) => team === next),
          }),
          resetScroll: false,
        })
      }
      onDeadlineChange={(next) =>
        void navigate({
          search: (previous) => ({ ...previous, deadline: next === "all" ? undefined : next }),
          resetScroll: false,
        })
      }
      renderCaseLink={(id, content, xstyle) => (
        <Link to="/desligamentos/$caseId" params={{ caseId: id }} {...classProps(xstyle)}>
          {content}
        </Link>
      )}
    />
  );
}
