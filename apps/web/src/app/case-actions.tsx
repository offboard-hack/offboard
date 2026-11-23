import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, lazyRouteComponent } from "@tanstack/react-router";
import { offboardingsQuery, type OffboardingCase } from "@/entities/offboarding";
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
            const response = await fetch("/api/offboardings", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: record.name,
                role: record.role,
                department: record.department,
                deadline: record.deadline,
              }),
            });

            if (!response.ok) {
              throw new Error("Failed to create offboarding");
            }

            const created: OffboardingCase = await response.json();

            await queryClient.invalidateQueries({ queryKey: offboardingsQuery.queryKey });
            await navigate({ to: "/desligamentos/$caseId", params: { caseId: created.id } });
          })()
        }
      />
    </div>
  );
}
