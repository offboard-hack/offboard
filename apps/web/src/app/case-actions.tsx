import { getApiClient } from "@/shared/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, lazyRouteComponent } from "@tanstack/react-router";
import { offboardingsQuery } from "@/entities/offboarding";
import { ImportModal } from "@/features/bulk-import/import-modal";
import { NewCaseDialog } from "@/features/offboarding/new-case-dialog";

const route = getRouteApi("/_portal/desligamentos");

const ImportPage = lazyRouteComponent(
  () => import("@/features/bulk-import/import-page"),
  "ImportPage",
);

export function CaseActions() {
  const navigate = route.useNavigate();
  const queryClient = useQueryClient();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ImportModal>
        <ImportPage modal />
      </ImportModal>
      <NewCaseDialog
        onCreate={(record) =>
          void (async () => {
            const { data: created, error } = await getApiClient().api.offboardings.post(record);

            if (error) throw new Error("Failed to create offboarding");

            await queryClient.invalidateQueries({ queryKey: offboardingsQuery.queryKey });
            await navigate({ to: "/desligamentos/$caseId", params: { caseId: created.id } });
          })()
        }
      />
    </div>
  );
}
