import { createPortalAbility } from "@offboard/access";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, lazyRouteComponent, Link } from "@tanstack/react-router";
import { offboardingTeams, offboardingsQuery, type CaseSummary } from "@/entities/offboarding";
import { CasesPage } from "@/features/offboarding/offboarding-pages";
import { offboardingStyles } from "@/features/offboarding/offboarding.styles";
import { classProps } from "@/shared/lib/class-props";
import { ListBreadcrumb } from "@/shared/ui/list-page";

const portalRoute = getRouteApi("/_portal");
const casesRoute = getRouteApi("/_portal/desligamentos");
const CaseActions = lazyRouteComponent(() => import("./case-actions"), "CaseActions");

function CaseLink(item: CaseSummary) {
  return (
    <Link
      to="/desligamentos/$caseId"
      params={{ caseId: item.id }}
      {...classProps(offboardingStyles.caseLink)}
    >
      {item.name}
    </Link>
  );
}

export function Cases() {
  const { principal } = portalRoute.useRouteContext();
  const canCreateCase = createPortalAbility(principal.role).can("create", "Offboarding");
  const { data: cases } = useSuspenseQuery(offboardingsQuery);
  const { area, status = "", team = "", page } = casesRoute.useSearch();
  const navigate = casesRoute.useNavigate();
  const department = area ?? "";

  return (
    <CasesPage
      cases={cases}
      department={department}
      status={status}
      team={team}
      onStatusChange={(next) =>
        void navigate({
          search: (previous) => ({ ...previous, status: next || undefined, page: undefined }),
          resetScroll: false,
        })
      }
      onTeamChange={(next) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            team: offboardingTeams.find((team) => team === next),
            page: undefined,
          }),
          resetScroll: false,
        })
      }
      onResetFilters={() =>
        void navigate({
          search: (previous) => ({ pageSize: previous.pageSize }),
          resetScroll: false,
        })
      }
      onNameSearchChange={() => {
        if (page) {
          void navigate({
            search: (previous) => ({ ...previous, page: undefined }),
            replace: true,
            resetScroll: false,
          });
        }
      }}
      onDepartmentChange={(next) => {
        if (department !== next) {
          void navigate({
            search: (previous) => ({ ...previous, area: next || undefined, page: undefined }),
            resetScroll: false,
          });
        }
      }}
      renderCaseLink={CaseLink}
      onOpenCase={({ id }) => {
        void navigate({ to: "/desligamentos/$caseId", params: { caseId: id } });
      }}
      breadcrumb={<ListBreadcrumb title="Desligamentos" />}
      actions={canCreateCase ? <CaseActions /> : undefined}
    />
  );
}
