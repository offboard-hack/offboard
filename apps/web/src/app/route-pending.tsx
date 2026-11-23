import { ListPendingPage } from "@/shared/ui/list-pending-page";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";

function TablePlaceholder({ filters = true }: { filters?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      {filters && (
        <div className="flex flex-wrap gap-3 border-b p-4">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-32" />
        </div>
      )}
      <div className="flex gap-5 border-b bg-muted/30 px-4 py-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="ml-auto h-3 w-16" />
      </div>
      {Array.from({ length: 4 }, (_, row) => (
        <div key={row} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="grid min-w-0 flex-1 gap-2">
            <Skeleton className="h-3 w-28 max-w-full" />
            <Skeleton className="h-2.5 w-20 max-w-full" />
          </div>
          <Skeleton className="hidden h-3 w-20 sm:block" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function MetricsPlaceholder() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, metric) => (
        <div key={metric} className="grid gap-3 rounded-2xl border bg-card p-4">
          <Skeleton className="h-3 w-24 max-w-full" />
          <Skeleton className="h-6 w-10" />
        </div>
      ))}
    </div>
  );
}

export function CasesPending() {
  return (
    <ListPendingPage title="Desligamentos">
      <MetricsPlaceholder />
      <TablePlaceholder />
    </ListPendingPage>
  );
}

export function TeamPending() {
  return (
    <ListPendingPage title="Equipe">
      <TablePlaceholder filters={false} />
    </ListPendingPage>
  );
}

export function EquipmentPending() {
  return (
    <ListPendingPage title="Bens e coleta">
      <MetricsPlaceholder />
      <TablePlaceholder />
    </ListPendingPage>
  );
}

export function DashboardPending() {
  return (
    <ListPendingPage title="Painel">
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((chart) => (
          <div key={chart} className="grid gap-4 rounded-2xl border bg-card p-5">
            <Skeleton className="h-4 w-40" />
            <div className="flex items-center gap-4">
              <Skeleton className="size-24 shrink-0 rounded-full" />
              <div className="grid gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <TablePlaceholder />
    </ListPendingPage>
  );
}

export function CasePending() {
  return (
    <ListPendingPage title="Desligamento">
      <div className="flex items-center gap-4 rounded-2xl border bg-card p-5">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="grid gap-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <TablePlaceholder filters={false} />
    </ListPendingPage>
  );
}

export function IntegrationsPending() {
  return (
    <ListPendingPage title="Integrações">
      <Skeleton className="h-11 w-full max-w-xs rounded-full" />
      <Skeleton className="h-4 w-36" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <div key={card} className="grid gap-3 rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="size-10" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48 max-w-full" />
            <div className="border-t pt-3">
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </ListPendingPage>
  );
}
