import { phases, teams } from "./checklist-draft";
import { ListPendingPage } from "@/shared/ui/list-pending-page";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";

export function ChecklistPending() {
  return (
    <ListPendingPage title="Checklist automático">
      <div className="min-w-0 overflow-hidden rounded-2xl border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
          <div className="grid min-w-0 gap-1.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="h-5 w-96 max-w-full" />
            <Skeleton className="h-5 w-60 max-w-full lg:hidden" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24 rounded-full" />
            <Skeleton className="h-9 w-32 rounded-full" />
          </div>
        </div>
        <div className="overflow-hidden border-t">
          <div className="min-w-[67rem]">
            <div className="flex bg-primary/8 dark:bg-primary/18">
              <div className="w-24 bg-muted/65 p-3 sm:w-36 sm:px-4">
                <Skeleton className="h-5 w-12" />
              </div>
              {phases.map(({ id }) => (
                <div key={id} className="flex-1 border-l border-primary/12 p-3">
                  <Skeleton className="h-5 w-28" />
                </div>
              ))}
            </div>
            {teams.map((team) => (
              <div key={team} className="flex border-t">
                <div className="w-24 bg-muted/30 px-3 py-4 sm:w-36 sm:px-4">
                  <Skeleton className="h-5 w-14" />
                </div>
                {phases.map(({ id }) => (
                  <div key={id} className="flex-1 border-l p-3">
                    <Skeleton className="h-16 w-full" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </ListPendingPage>
  );
}
