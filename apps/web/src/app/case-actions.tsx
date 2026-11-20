import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, lazyRouteComponent } from "@tanstack/react-router";
import { offboardingsQuery } from "@/entities/offboarding";
import { ImportModal } from "@/features/bulk-import/import-modal";
import { createTasksFromChecklist } from "@/features/checklist/checklist-draft";
import { NewCaseDialog } from "@/features/offboarding/new-case-dialog";
import { createLocalId } from "@/shared/lib/create-local-id";

const route = getRouteApi("/desligamentos");

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
        onCreate={(record) => {
          const id = createLocalId();
          const tasks = createTasksFromChecklist(record);

          queryClient.setQueryData(offboardingsQuery.queryKey, (current = []) => [
            ...current,
            { ...record, id, tasks, completed: 0, total: tasks.length },
          ]);
          void navigate({ to: "/desligamentos/$caseId", params: { caseId: id } });
        }}
      />
    </div>
  );
}
