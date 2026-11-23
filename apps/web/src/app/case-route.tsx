import { createPortalAbility } from "@offboard/access";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link, notFound } from "@tanstack/react-router";
import {
  cycleTaskStatus,
  offboardingQuery,
  offboardingsQuery,
  toggleSubtask,
  updateTaskStatus,
  type OffboardingCase,
  type PersonAsset,
  type Task,
} from "@/entities/offboarding";
import { CasePage } from "@/features/offboarding/offboarding-pages";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/shadcn/breadcrumb";

const portalRoute = getRouteApi("/_portal");
const caseRoute = getRouteApi("/_portal/desligamentos_/$caseId");

export function Case() {
  const { principal } = portalRoute.useRouteContext();
  const canUpdateCase = createPortalAbility(principal.role).can("update", "Offboarding");
  const { caseId } = caseRoute.useParams();
  const { tasks } = caseRoute.useSearch();
  const navigate = caseRoute.useNavigate();
  const queryClient = useQueryClient();
  const detailQuery = offboardingQuery(caseId, queryClient);
  const { data: detail } = useSuspenseQuery(detailQuery);

  async function updateCachedCase(update: (item: OffboardingCase) => OffboardingCase) {
    await queryClient.cancelQueries({ queryKey: offboardingsQuery.queryKey });
    const previousList = queryClient.getQueryData(offboardingsQuery.queryKey);
    const previousDetail = queryClient.getQueryData(detailQuery.queryKey);

    queryClient.setQueryData(offboardingsQuery.queryKey, (list) =>
      list?.map((item) => (item.id === caseId ? update(item) : item)),
    );
    queryClient.setQueryData(detailQuery.queryKey, (item) => (item ? update(item) : item));

    return () => {
      if (previousList) queryClient.setQueryData(offboardingsQuery.queryKey, previousList);

      if (previousDetail) queryClient.setQueryData(detailQuery.queryKey, previousDetail);
    };
  }

  const statusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: Task["status"] }) =>
      updateTaskStatus(taskId, cycleTaskStatus(status)),
    onMutate: ({ taskId, status }) =>
      updateCachedCase((item) => {
        const tasks = item.tasks.map((task) =>
          task.id === taskId ? { ...task, status: cycleTaskStatus(status) } : task,
        );

        return { ...item, tasks, completed: tasks.filter((task) => task.status === "done").length };
      }),
    onError: (_error, _variables, rollback) => rollback?.(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: offboardingsQuery.queryKey });
    },
  });

  const subtaskMutation = useMutation({
    mutationFn: (subtaskId: string) => toggleSubtask(subtaskId),
    onMutate: (subtaskId) =>
      updateCachedCase((item) => ({
        ...item,
        tasks: item.tasks.map((task) => ({
          ...task,
          subtasks: task.subtasks.map((subtask) =>
            subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask,
          ),
        })),
      })),
    onError: (_error, _variables, rollback) => rollback?.(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: offboardingsQuery.queryKey });
    },
  });

  if (!detail) throw notFound();

  const offboardingCase = enrichCase(detail);

  return (
    <CasePage
      offboardingCase={offboardingCase}
      taskFilter={tasks ?? ""}
      taskWritePending={statusMutation.isPending || subtaskMutation.isPending}
      taskWriteError={statusMutation.isError || subtaskMutation.isError}
      onTaskFilterChange={(next) =>
        void navigate({ search: { tasks: next || undefined }, resetScroll: false })
      }
      onTaskStatusChange={
        canUpdateCase
          ? (taskId, status) => {
              subtaskMutation.reset();
              statusMutation.mutate({ taskId, status });
            }
          : undefined
      }
      onSubtaskToggle={
        canUpdateCase
          ? (subtaskId) => {
              statusMutation.reset();
              subtaskMutation.mutate(subtaskId);
            }
          : undefined
      }
      breadcrumb={
        <Breadcrumb aria-label="Localização">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/painel" />}>Painel</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link to="/desligamentos" activeOptions={{ exact: true }} />}>
                Desligamentos
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{offboardingCase.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    />
  );
}

const demoAssets: PersonAsset[] = [
  { item: "Notebook Dell Latitude 5440", tag: "AUR-0412", status: "scheduled" },
  { item: "Monitor Dell 27″", tag: "AUR-3104", status: "withPerson" },
  { item: "Celular Galaxy A55", tag: "AUR-2210", status: "received" },
];

function enrichCase(offboardingCase: OffboardingCase) {
  return {
    ...offboardingCase,
    assets: offboardingCase.assets ?? demoAssets,
  };
}
