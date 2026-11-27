import { createPortalAbility } from "@offboard/access";
import {
  Add01Icon,
  Calendar03Icon,
  CreditCardIcon,
  Delete02Icon,
  Tick02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import {
  benefitAssignmentsQuery,
  benefitPlansQuery,
  benefitPolicyQuery,
  costSummary,
  policyDefaults,
  useAssignBenefit,
  useSaveBenefitPolicy,
  useUpdateAssignment,
  type BenefitAssignmentRow,
  type BenefitPlanOption,
} from "@/entities/benefits";
import { offboardingDepartments } from "@/entities/offboarding";
import { DataTable, type TableColumn } from "@/shared/ui/data-table";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { PortalFilter } from "@/shared/ui/select";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/shadcn/dialog";
import { Input } from "@/shared/ui/shadcn/input";
import { portalStyles } from "@/shared/ui/surface.styles";
import {
  benefitPolicySchema,
  durationOptions,
  emptyRule,
  ruleFieldOptions,
  ruleOperatorOptions,
} from "./policy-form";

const portalRoute = getRouteApi("/_portal");

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatCents(cents: number) {
  return currency.format(cents / 100);
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" });

const sources = {
  default: "Padrão",
  rule: "Regra",
  manual: "Manual",
} satisfies Record<BenefitAssignmentRow["source"], string>;

const departmentOptions = [
  { value: "", label: "Escolha uma área" },
  ...offboardingDepartments.map((department) => ({ value: department, label: department })),
];

export function BenefitsPage() {
  const { principal } = portalRoute.useRouteContext();
  const canManage = createPortalAbility(principal.role).can("manage", "Billing");
  const { data: policyData } = useSuspenseQuery(benefitPolicyQuery);
  const { data: assignments } = useSuspenseQuery(benefitAssignmentsQuery);
  const { data: plans } = useSuspenseQuery(benefitPlansQuery);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState<BenefitAssignmentRow | null>(null);

  const policy = policyDefaults(policyData);
  const summary = costSummary(assignments, plans);
  const defaultPlan = plans.find((plan) => plan.id === policy.defaultPlanId);

  const columns: TableColumn<BenefitAssignmentRow>[] = [
    {
      id: "name",
      accessorFn: ({ profileName }) => profileName,
      header: "Nome",
      meta: { cellStyle: portalStyles.tableHeading },
    },
    {
      id: "assigned",
      accessorFn: ({ assignedPlanName }) => assignedPlanName,
      header: "Plano atribuído",
    },
    {
      id: "effective",
      accessorFn: ({ effectivePlanName }) => effectivePlanName,
      header: "Plano efetivo",
    },
    {
      id: "source",
      accessorFn: ({ source }) => sources[source],
      header: "Fonte",
      cell: ({ row }) => <Badge variant="secondary">{sources[row.original.source]}</Badge>,
    },
    {
      id: "validUntil",
      accessorFn: ({ validUntil }) => dateFormat.format(new Date(`${validUntil}T00:00:00Z`)),
      header: "Válido até",
    },
    ...(canManage
      ? [
          {
            id: "actions",
            accessorFn: ({ id }) => id,
            header: "Ações",
            cell: ({ row }) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Alterar benefício de ${row.original.profileName}`}
                onClick={() => setEditing(row.original)}
              >
                Alterar
              </Button>
            ),
          } satisfies TableColumn<BenefitAssignmentRow>,
        ]
      : []),
  ];

  return (
    <ListPage
      title="Benefícios"
      breadcrumb={<ListBreadcrumb title="Benefícios" />}
      metrics={[
        {
          label: "Custo mensal",
          value: formatCents(summary.totalCents),
          icon: Calendar03Icon,
          tone: "warning",
        },
        {
          label: "Total de atribuições",
          value: assignments.length,
          icon: UserGroupIcon,
          tone: "success",
        },
        {
          label: "Duração padrão",
          value: `${policy.benefitDurationMonths} ${policy.benefitDurationMonths === 1 ? "mês" : "meses"}`,
          icon: Tick02Icon,
          tone: "primary",
        },
        {
          label: "Plano padrão",
          value: defaultPlan?.name ?? "Nenhum",
          icon: CreditCardIcon,
          tone: "primary",
        },
      ]}
    >
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-6">
          <PolicyCard policy={policy} plans={plans} canManage={canManage} />
          <section className="min-w-0" aria-labelledby="assignments-title">
            <DataTable
              toolbar={
                <h2 className={portalStyles.subheading} id="assignments-title">
                  Atribuições
                </h2>
              }
              toolbarEnd={
                canManage && (
                  <Button
                    type="button"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setAssigning(true)}
                  >
                    <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
                    Atribuir benefício
                  </Button>
                )
              }
              data={assignments}
              columns={columns}
              labelledBy="assignments-title"
              getRowId={({ id }) => id}
              scrollLabel="Tabela de atribuições"
              tableStyle="min-w-2xl"
              emptyText="Nenhuma atribuição de benefício."
            />
          </section>
        </div>
        <section
          className="min-w-0 overflow-hidden rounded-2xl border bg-card"
          aria-labelledby="cost-title"
        >
          <div className={`${portalStyles.panelHeader} min-h-12 px-3 sm:px-5`}>
            <h2 className={portalStyles.subheading} id="cost-title">
              Custo por plano
            </h2>
          </div>
          <ul className="divide-y">
            {summary.tiers.map((tier) => (
              <li
                key={tier.name}
                className="flex items-center justify-between gap-3 px-3 py-3 sm:px-5"
              >
                <span>
                  {tier.name} <span className="text-muted-foreground">× {tier.count}</span>
                </span>
                <span className="tabular-nums">{formatCents(tier.subtotalCents)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 px-3 py-3 font-semibold sm:px-5">
              <span>Total</span>
              <span className="tabular-nums">{formatCents(summary.totalCents)}</span>
            </li>
          </ul>
        </section>
      </div>
      <AssignDialog
        key={assigning ? "assign-open" : "assign-closed"}
        open={assigning}
        onClose={() => setAssigning(false)}
        assignments={assignments}
        plans={plans}
      />
      <UpdateDialog
        key={editing?.id ?? "update-closed"}
        assignment={editing}
        onClose={() => setEditing(null)}
        plans={plans}
      />
    </ListPage>
  );
}

type Plans = BenefitPlanOption[];

function PolicyCard({
  policy,
  plans,
  canManage,
}: {
  policy: ReturnType<typeof policyDefaults>;
  plans: Plans;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();

  const save = useSaveBenefitPolicy(() => {
    void queryClient.invalidateQueries({ queryKey: benefitPolicyQuery.queryKey });
    void queryClient.invalidateQueries({ queryKey: benefitAssignmentsQuery.queryKey });
  });

  const planItems = plans.map((plan) => ({ value: plan.id, label: plan.name }));
  const defaultItems = [{ value: "", label: "Nenhum" }, ...planItems];

  const form = useForm({
    defaultValues: {
      defaultPlanId: policy.defaultPlanId,
      benefitDurationMonths: policy.benefitDurationMonths,
      rules: policy.rules.map((rule) => ({ ...rule })),
    },
    validators: { onSubmit: benefitPolicySchema },
    onSubmit: ({ value }) => save.mutateAsync(benefitPolicySchema.parse(value)),
  });

  return (
    <section className="min-w-0 rounded-2xl border bg-card" aria-labelledby="policy-title">
      <div className={`${portalStyles.panelHeader} min-h-12 px-3 sm:px-5`}>
        <h2 className={portalStyles.subheading} id="policy-title">
          Política de benefícios
        </h2>
      </div>
      <form
        noValidate
        className="grid gap-4 px-3 py-4 sm:px-5"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <form.Field name="defaultPlanId">
            {(field) => (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Plano padrão</span>
                <PortalFilter
                  label="Plano padrão"
                  className="w-full"
                  disabled={!canManage}
                  value={field.state.value ?? ""}
                  items={defaultItems}
                  onChange={(value) => field.handleChange(value === "" ? null : value)}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="benefitDurationMonths">
            {(field) => (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Duração do benefício</span>
                <PortalFilter
                  label="Duração do benefício"
                  className="w-full"
                  disabled={!canManage}
                  value={String(field.state.value)}
                  items={durationOptions}
                  onChange={(value) => field.handleChange(Number(value))}
                />
              </div>
            )}
          </form.Field>
        </div>
        <form.Field name="rules">
          {(field) => (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold">Regras</h3>
                {canManage && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={plans.length === 0}
                    onClick={() => form.pushFieldValue("rules", emptyRule(plans))}
                  >
                    <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
                    Adicionar regra
                  </Button>
                )}
              </div>
              {field.state.value.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Sem regras, todos recebem o plano padrão.
                </p>
              )}
              {field.state.value.map((rule, index) => (
                <div
                  key={rule.id}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-xl border bg-muted/25 p-2"
                >
                  <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <form.Field name={`rules[${index}].field`}>
                      {(attribute) => (
                        <PortalFilter
                          label={`Campo da regra ${index + 1}`}
                          className="w-full"
                          disabled={!canManage}
                          value={attribute.state.value}
                          items={ruleFieldOptions}
                          onChange={(value) => {
                            if (value !== attribute.state.value) {
                              attribute.handleChange(value === "role" ? "role" : "department");
                              form.setFieldValue(`rules[${index}].value`, "");
                            }
                          }}
                        />
                      )}
                    </form.Field>
                    <form.Field name={`rules[${index}].operator`}>
                      {(operator) => (
                        <PortalFilter
                          label={`Comparação da regra ${index + 1}`}
                          className="w-full"
                          disabled={!canManage}
                          value={operator.state.value}
                          items={ruleOperatorOptions}
                          onChange={(value) => {
                            const next = ruleOperatorOptions.find((item) => item.value === value);

                            if (next) {
                              const prev = operator.state.value;

                              const nextOp =
                                next.value === "notEquals"
                                  ? "notEquals"
                                  : next.value === "contains"
                                    ? "contains"
                                    : "equals";

                              operator.handleChange(nextOp);

                              if (
                                rule.field === "department" &&
                                (prev === "contains") !== (nextOp === "contains")
                              ) {
                                form.setFieldValue(`rules[${index}].value`, "");
                              }
                            }
                          }}
                        />
                      )}
                    </form.Field>
                    <form.Field name={`rules[${index}].value`}>
                      {(value) => {
                        const error = value.state.meta.errors[0]?.message;

                        return (
                          <div className="grid min-w-0 gap-1">
                            {rule.field === "department" && rule.operator !== "contains" ? (
                              <PortalFilter
                                label={`Área da regra ${index + 1}`}
                                className="w-full"
                                disabled={!canManage}
                                value={value.state.value}
                                items={departmentOptions}
                                onChange={value.handleChange}
                                invalid={Boolean(error)}
                              />
                            ) : (
                              <Input
                                className="h-11"
                                aria-label={`Valor da regra ${index + 1}`}
                                placeholder={
                                  rule.field === "role" ? "Nome do cargo" : "Nome da área"
                                }
                                disabled={!canManage}
                                value={value.state.value}
                                onChange={(event) => value.handleChange(event.currentTarget.value)}
                                aria-invalid={Boolean(error)}
                              />
                            )}
                            {error && (
                              <p role="alert" className="text-destructive">
                                {error}
                              </p>
                            )}
                          </div>
                        );
                      }}
                    </form.Field>
                    <form.Field name={`rules[${index}].planId`}>
                      {(plan) => (
                        <PortalFilter
                          label={`Plano da regra ${index + 1}`}
                          className="w-full"
                          disabled={!canManage}
                          value={plan.state.value}
                          items={planItems}
                          onChange={plan.handleChange}
                        />
                      )}
                    </form.Field>
                  </div>
                  {canManage && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-sm"
                      className="mt-1.5"
                      aria-label={`Remover regra ${index + 1}`}
                      onClick={() => form.removeFieldValue("rules", index)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </form.Field>
        {canManage && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.isPending}>
              Salvar política
            </Button>
            {save.isError && (
              <p role="alert" className="text-destructive">
                Não foi possível salvar a política. Tente novamente.
              </p>
            )}
            {save.isSuccess && <p role="status">Política salva.</p>}
          </div>
        )}
      </form>
    </section>
  );
}

function AssignDialog({
  open,
  onClose,
  assignments,
  plans,
}: {
  open: boolean;
  onClose: () => void;
  assignments: BenefitAssignmentRow[];
  plans: Plans;
}) {
  const queryClient = useQueryClient();
  const [profileId, setProfileId] = useState(assignments[0]?.profileId ?? "");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");

  const assign = useAssignBenefit(() => {
    void queryClient.invalidateQueries({ queryKey: benefitAssignmentsQuery.queryKey });
    onClose();
  });

  const profiles = assignments.map(({ profileId, profileName }) => ({
    value: profileId,
    label: profileName,
  }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atribuir benefício</DialogTitle>
          <DialogDescription>Define manualmente o plano de uma pessoa.</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            assign.mutate({ profileId, planId });
          }}
        >
          <DialogBody className="grid gap-4">
            <PortalFilter
              label="Pessoa"
              className="w-full"
              value={profileId}
              items={profiles}
              onChange={setProfileId}
            />
            <PortalFilter
              label="Plano"
              className="w-full"
              value={planId}
              items={plans.map((plan) => ({ value: plan.id, label: plan.name }))}
              onChange={setPlanId}
            />
            {assign.isError && (
              <p role="alert" className="text-destructive">
                Não foi possível atribuir o benefício. Tente novamente.
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={assign.isPending || !profileId || !planId}>
              Atribuir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UpdateDialog({
  assignment,
  onClose,
  plans,
}: {
  assignment: BenefitAssignmentRow | null;
  onClose: () => void;
  plans: Plans;
}) {
  const queryClient = useQueryClient();

  const [planId, setPlanId] = useState(
    plans.find((plan) => plan.name === assignment?.assignedPlanName)?.id ?? plans[0]?.id ?? "",
  );

  const update = useUpdateAssignment(() => {
    void queryClient.invalidateQueries({ queryKey: benefitAssignmentsQuery.queryKey });
    onClose();
  });

  return (
    <Dialog open={assignment !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alterar benefício</DialogTitle>
          <DialogDescription>{assignment?.profileName}</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();

            if (assignment) update.mutate({ id: assignment.id, planId });
          }}
        >
          <DialogBody className="grid gap-4">
            <PortalFilter
              label="Plano"
              className="w-full"
              value={planId}
              items={plans.map((plan) => ({ value: plan.id, label: plan.name }))}
              onChange={setPlanId}
            />
            {update.isError && (
              <p role="alert" className="text-destructive">
                Não foi possível alterar o benefício. Tente novamente.
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={update.isPending || !planId}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
