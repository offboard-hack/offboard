import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import FirstAidKitIcon from "@hugeicons/core-free-icons/FirstAidKitIcon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import Package01Icon from "@hugeicons/core-free-icons/Package01Icon";
import Task01Icon from "@hugeicons/core-free-icons/Task01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { employeeDate, type EmployeeState } from "@offboard/employee";
import { feedbackTopics } from "@offboard/employee/departure";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  type EmployeeAccount,
  type EmployeeJourney,
  useEmployeeChecklistWrite,
  useEmployeeTrackingCode,
  employeeTrackingQuery,
  useEmployeeWrite,
} from "@/entities/employee";
import { todayAtWorkspace } from "@/entities/offboarding";
import { ProgressBar } from "@/shared/ui/progress";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import { Checkbox } from "@/shared/ui/shadcn/checkbox";
import { Input } from "@/shared/ui/shadcn/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/shared/ui/shadcn/item";
import { Label } from "@/shared/ui/shadcn/label";
import { Textarea } from "@/shared/ui/shadcn/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/shadcn/toggle-group";
import {
  feedbackStepIssues,
  feedbackStepRatings,
  feedbackSteps,
  feedbackWizardDefaults,
  toDepartureFeedback,
} from "./feedback-wizard";
import { isDeadlineOverdue } from "./deadline-overdue";
import { returnStatus } from "./return-status";
import { EmployeeEmpty, EmployeeError, EmployeePanel } from "./ui";

type DepartureState = Extract<EmployeeState, { key: "departure-v1" }>;

const dayFormat = { day: "numeric", month: "long", year: "numeric" } as const;

function deadlineLabel(journey: EmployeeJourney) {
  return employeeDate(journey.deadline, dayFormat);
}

export function DepartureOverview({
  journey,
  state,
  home,
}: {
  journey: EmployeeJourney;
  state: DepartureState;
  home: boolean;
}) {
  const { plan } = journey;
  const { handoffCompleted, examAttended, feedback } = state.value;

  const equipmentReceived =
    journey.equipment.length > 0 && journey.equipment.every((item) => item.received);

  const reviewed = plan.handoff.filter(({ id }) => handoffCompleted.includes(id)).length;
  const deadlineOverdue = isDeadlineOverdue(journey.deadline, todayAtWorkspace());
  const examCanBeConfirmed = plan.exam && plan.exam.day <= todayAtWorkspace();

  const steps = [
    {
      to: "passagem",
      icon: Task01Icon,
      title: "Passar seu trabalho",
      status:
        plan.handoff.length === 0
          ? "tracking"
          : reviewed === plan.handoff.length
            ? "completed"
            : "pending",
      description: plan.handoff.length
        ? `Itens revisados: ${reviewed} de ${plan.handoff.length}`
        : "Nenhum item informado",
    },
    {
      to: "equipamentos",
      icon: Package01Icon,
      title: "Devolver equipamentos",
      status: equipmentReceived
        ? "completed"
        : journey.trackingCode || journey.equipment.length === 0
          ? "tracking"
          : "pending",
      description: equipmentReceived
        ? "Recebimento confirmado"
        : journey.trackingCode
          ? "Postado nos Correios"
          : journey.equipment.length === 1
            ? "1 equipamento informado"
            : `${journey.equipment.length} equipamentos informados`,
    },
    {
      to: "exame",
      icon: FirstAidKitIcon,
      title: "Fazer o exame demissional",
      status: examAttended ? "completed" : examCanBeConfirmed ? "pending" : "tracking",
      description: examAttended
        ? "Comparecimento registrado"
        : plan.exam
          ? employeeDate(plan.exam.day, dayFormat)
          : "Agendamento ainda não informado",
    },
    {
      to: "rescisao",
      icon: File01Icon,
      title: "Receber o termo de rescisão",
      status: "tracking",
      overdue: deadlineOverdue,
      description: `Prazo informado pelo RH: ${deadlineLabel(journey)}${deadlineOverdue ? " · em atraso" : ""}`,
    },
    {
      to: "feedback",
      icon: Message01Icon,
      title: "Avaliar minha saída",
      status: feedback ? "completed" : "pending",
      description: feedback ? "Resposta salva" : "Pesquisa opcional",
    },
  ] as const;

  const groups = [
    {
      title: home ? "Próximas etapas" : "Etapas pendentes",
      items: steps.filter(({ status }) => status === "pending"),
    },
    { title: "Acompanhar", items: steps.filter(({ status }) => status === "tracking") },
    { title: "Etapas concluídas", items: steps.filter(({ status }) => status === "completed") },
  ];

  return groups.map(({ title: groupTitle, items }) =>
    items.length ? (
      <EmployeePanel key={groupTitle} title={groupTitle}>
        <ul className="divide-y">
          {items.map(({ to, title, icon, description, ...step }) => (
            <li key={to}>
              <Item size="sm" render={<Link to="/colaborador" search={{ tela: to }} />}>
                <ItemMedia variant="icon">
                  <HugeiconsIcon icon={icon} aria-hidden="true" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="block wrap-anywhere">{title}</ItemTitle>
                  <ItemDescription
                    className={"overdue" in step && step.overdue ? "text-destructive" : undefined}
                  >
                    {description}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
      </EmployeePanel>
    ) : null,
  );
}

type DepartureProps = { account: EmployeeAccount; journey: EmployeeJourney; state: DepartureState };

export function EmployeeChecklist({
  account,
  journey,
}: Pick<DepartureProps, "account" | "journey">) {
  const write = useEmployeeChecklistWrite(account);

  if (journey.checklist.length === 0) return null;

  return (
    <EmployeePanel title="Checklist do desligamento">
      <ul className="divide-y">
        {journey.checklist.map((item) => {
          const completed = item.status === "done";

          const label = (
            <span className="min-w-0">
              <span className="block font-bold wrap-anywhere">{item.title}</span>
              {item.description ? (
                <span className="block text-muted-foreground wrap-anywhere">
                  {item.description}
                </span>
              ) : null}
              {item.dueDate ? (
                <time className="block text-sm text-muted-foreground" dateTime={item.dueDate}>
                  Prazo até {employeeDate(item.dueDate, dayFormat)}
                  {item.dueTime ? ` às ${item.dueTime}` : ""}
                </time>
              ) : null}
            </span>
          );

          return (
            <li key={item.id} className="py-2">
              {item.action === "check" ? (
                <label className="flex min-h-11 items-center gap-3">
                  <Checkbox
                    checked={completed}
                    disabled={write.isPending}
                    onCheckedChange={(done) => write.mutate({ taskId: item.id, done })}
                  />
                  {label}
                </label>
              ) : (
                <Link
                  className="flex min-h-11 items-center justify-between gap-3 rounded-md hover:underline"
                  to="/colaborador"
                  search={{ tela: item.action === "equipment" ? "equipamentos" : "feedback" }}
                >
                  {label}
                  {completed ? (
                    <Badge variant="status-success">Concluída</Badge>
                  ) : (
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      className="size-4 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </Link>
              )}
              {write.variables?.taskId === item.id ? (
                <EmployeeError message={write.error?.message} />
              ) : null}
            </li>
          );
        })}
      </ul>
      {write.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Salvando…
        </p>
      ) : null}
    </EmployeePanel>
  );
}

export function Handoff({ account, journey, state }: DepartureProps) {
  const write = useEmployeeWrite(account);
  const { handoff } = journey.plan;
  const reviewed = handoff.filter(({ id }) => state.value.handoffCompleted.includes(id)).length;

  return (
    <div className="space-y-5">
      <EmployeePanel
        title="Itens da passagem"
        description={
          handoff.length ? `Itens revisados: ${reviewed} de ${handoff.length}` : undefined
        }
      >
        {handoff.length === 0 ? (
          <EmployeeEmpty>O RH ainda não informou itens para a passagem.</EmployeeEmpty>
        ) : null}
        <ul className="divide-y">
          {handoff.map((task) => {
            const checked = state.value.handoffCompleted.includes(task.id);

            return (
              <li key={task.id} className="py-3">
                <label className="flex min-h-11 items-center gap-3">
                  <Checkbox
                    checked={checked}
                    disabled={write.isPending}
                    onCheckedChange={() =>
                      write.mutate({
                        ...state,
                        value: {
                          ...state.value,
                          handoffCompleted: checked
                            ? state.value.handoffCompleted.filter((id) => id !== task.id)
                            : [...state.value.handoffCompleted, task.id],
                        },
                      })
                    }
                  />
                  <span>
                    <span className="block font-bold">{task.title}</span>
                    <span className="text-sm text-muted-foreground">
                      {task.owner} · {task.area}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <EmployeeError message={write.error?.message} />
        {write.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Salvando…
          </p>
        ) : null}
      </EmployeePanel>
    </div>
  );
}

export function Equipment({
  account,
  journey,
}: {
  account: EmployeeAccount;
  journey: EmployeeJourney;
}) {
  const { officeAddress } = journey.plan;
  const { equipment, trackingCode } = journey;
  const pending = equipment.filter((item) => !item.received).length;
  const allReceived = equipment.length > 0 && pending === 0;

  return (
    <div className="space-y-5">
      {allReceived ? (
        <EmployeePanel title="Devolução concluída">
          <p>A equipe confirmou o recebimento de todos os bens.</p>
        </EmployeePanel>
      ) : null}
      {pending > 0 ? (
        <EmployeePanel
          title="Postar nos Correios"
          description="Leve todos os bens em uma única embalagem a uma agência dos Correios."
        >
          <ol className="list-decimal space-y-2 pl-5">
            <li>Embale os bens listados abaixo juntos, protegidos para o transporte.</li>
            <li>
              Poste em qualquer agência dos Correios, em nome da empresa
              {officeAddress ? (
                <>
                  , no endereço <span className="font-bold wrap-anywhere">{officeAddress}</span>
                </>
              ) : (
                ". O RH ainda não informou o endereço de destino; confirme com ele antes de postar"
              )}
              .
            </li>
            <li>Guarde o comprovante e informe o código de rastreio abaixo.</li>
          </ol>
        </EmployeePanel>
      ) : null}
      {pending > 0 ? <TrackingCodeInput account={account} trackingCode={trackingCode} /> : null}
      {trackingCode ? (
        <ReturnTracking account={account} trackingCode={trackingCode} done={allReceived} />
      ) : null}
      <EmployeePanel title={`Bens vinculados (${equipment.length})`}>
        {equipment.length === 0 ? (
          <EmployeeEmpty>Nenhum equipamento informado pelo RH.</EmployeeEmpty>
        ) : null}
        <ul className="divide-y">
          {equipment.map((item) => (
            <li key={item.code} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-bold wrap-anywhere">{item.title}</p>
                <p className="text-sm wrap-anywhere text-muted-foreground">
                  {[item.model, item.code].filter(Boolean).join(" · ")}
                </p>
              </div>
              {item.received ? (
                <Badge variant="status-success" className="shrink-0">
                  Recebido
                </Badge>
              ) : trackingCode ? (
                <Badge variant="secondary" className="shrink-0">
                  Postado
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      </EmployeePanel>
    </div>
  );
}

function ReturnTracking({
  account,
  trackingCode,
  done,
}: {
  account: EmployeeAccount;
  trackingCode: string;
  done: boolean;
}) {
  const { data, isPending } = useQuery(employeeTrackingQuery(account));
  const status = returnStatus(trackingCode, data?.tracking);

  return (
    <EmployeePanel
      title="Acompanhamento da devolução"
      description={
        data?.tracking === null
          ? "O acompanhamento automático não está disponível. O RH confirma o recebimento quando o pacote chegar."
          : "Atualizado a partir dos Correios."
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={done || status.label === "Entregue" ? "status-success" : "secondary"}>
          {isPending ? "Consultando" : done ? "Entregue" : status.label}
        </Badge>
        <span className="font-mono text-sm text-muted-foreground">{trackingCode}</span>
      </div>
      {status.detail ? <p className="text-sm text-muted-foreground">{status.detail}</p> : null}
    </EmployeePanel>
  );
}

function TrackingCodeInput({
  account,
  trackingCode,
}: {
  account: EmployeeAccount;
  trackingCode: string | null;
}) {
  const write = useEmployeeTrackingCode(account);
  const [code, setCode] = useState(trackingCode ?? "");
  const saved = trackingCode !== null;

  return (
    <EmployeePanel
      title="Código de rastreio"
      description="Informe o código da transportadora para acompanhar a entrega."
    >
      {saved ? (
        <p className="font-mono font-bold">{trackingCode}</p>
      ) : (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();

            const normalized = code
              .trim()
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "");

            if (normalized) write.mutate(normalized, { onSuccess: () => setCode(normalized) });
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="tracking-code">Código</Label>
            <Input
              id="tracking-code"
              value={code}
              maxLength={30}
              placeholder="Ex: MM123456789BR"
              disabled={write.isPending}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={write.isPending || !code.trim()}>
            {write.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </form>
      )}
      <EmployeeError message={write.error?.message} />
    </EmployeePanel>
  );
}

export function Exam({ account, journey, state }: DepartureProps) {
  const write = useEmployeeWrite(account);
  const { exam } = journey.plan;
  const attended = state.value.examAttended;
  const canRegister = exam && exam.day <= todayAtWorkspace();

  return (
    <div className="space-y-5">
      <EmployeePanel
        title={exam?.clinic ?? "Agendamento ainda não informado"}
        description={exam ? `${employeeDate(exam.day, dayFormat)} · ${exam.time}` : undefined}
      >
        {exam ? (
          <>
            <p>{exam.address}</p>
            <p className="text-sm text-muted-foreground">
              Leve um documento com foto no dia do exame.
            </p>
            {attended ? (
              <p role="status" className="font-bold text-primary">
                Comparecimento registrado.
              </p>
            ) : null}
            {attended || canRegister ? (
              <Button
                disabled={write.isPending}
                variant={attended ? "outline" : "default"}
                onClick={() =>
                  write.mutate({
                    ...state,
                    value: { ...state.value, examAttended: !attended },
                  })
                }
              >
                {write.isPending
                  ? "Salvando…"
                  : attended
                    ? "Desfazer confirmação"
                    : "Registrar comparecimento"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Você poderá registrar o comparecimento a partir do dia do exame.
              </p>
            )}
            <EmployeeError message={write.error?.message} />
          </>
        ) : (
          <p className="text-muted-foreground">Confira com o RH se você precisa agendar o exame.</p>
        )}
      </EmployeePanel>
    </div>
  );
}

export function Termination({ journey }: { journey: EmployeeJourney }) {
  return (
    <div className="space-y-5">
      <EmployeePanel title="Prazo informado pelo RH">
        <p className="text-lg font-semibold">{deadlineLabel(journey)}</p>
        {journey.plan.lastDay ? (
          <p>Último dia de trabalho em {employeeDate(journey.plan.lastDay, dayFormat)}.</p>
        ) : null}
      </EmployeePanel>
      <EmployeePanel title="Documentos">
        <p className="text-muted-foreground">
          Consulte o RH para receber o termo de rescisão e o demonstrativo dos valores.
        </p>
      </EmployeePanel>
    </div>
  );
}

const selectedAnswer =
  "aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground";

const ratingOptions = [1, 2, 3, 4, 5];
const scoreOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function RatingScale({
  legend,
  options,
  low,
  high,
  value,
  error,
  onChange,
}: {
  legend: string;
  options: number[];
  low: string;
  high: string;
  value: number | null;
  error: string | undefined;
  onChange: (value: number | null) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold">{legend}</legend>
      <div className="w-fit max-w-full">
        <ToggleGroup
          aria-label={legend}
          variant="outline"
          className="max-w-full flex-wrap"
          value={value === null ? [] : [String(value)]}
          onValueChange={([next]) =>
            onChange(options.find((option) => String(option) === next) ?? null)
          }
        >
          {options.map((option) => (
            <ToggleGroupItem key={option} value={String(option)} className={selectedAnswer}>
              {option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="mt-2 flex justify-between gap-4 text-xs text-muted-foreground">
          <span>{low}</span>
          <span>{high}</span>
        </p>
      </div>
      <EmployeeError message={error} />
    </fieldset>
  );
}

export function Feedback({ account, state }: { account: EmployeeAccount; state: DepartureState }) {
  const write = useEmployeeWrite(account);
  const submitted = state.value.feedback;
  const [step, setStep] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const lastStep = feedbackSteps.length - 1;

  const form = useForm({
    defaultValues: feedbackWizardDefaults,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: {
      onDynamic: ({ value }) => {
        const issues = feedbackStepIssues(step, value);

        return Object.keys(issues).length > 0 ? { fields: issues } : undefined;
      },
    },
    onSubmitInvalid: () => setAttempted(true),
    onSubmit: ({ value }) => {
      if (step < lastStep) {
        setAttempted(false);
        setStep(step + 1);

        return;
      }

      write.mutate({
        ...state,
        value: { ...state.value, feedback: toDepartureFeedback(value) },
      });
    },
  });

  function fieldError(errors: readonly (string | undefined)[]) {
    return attempted ? errors[0] : undefined;
  }

  return (
    <div className="space-y-5">
      {submitted ? (
        <EmployeePanel title="Sua resposta está salva">
          <p className="text-sm text-muted-foreground">
            Obrigado por compartilhar sua experiência.
          </p>
        </EmployeePanel>
      ) : (
        <EmployeePanel title="Avaliar minha saída">
          <form
            className="grid gap-5"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Etapa {step + 1} de {feedbackSteps.length}
              </p>
              <ProgressBar
                label="Progresso da pesquisa"
                value={step + 1}
                max={feedbackSteps.length}
              />
              <h3 className="text-lg font-semibold">{feedbackSteps[step].title}</h3>
              <p className="text-sm text-muted-foreground">{feedbackSteps[step].description}</p>
            </div>
            {step === 0 ? (
              <form.Field name="recommendation">
                {(field) => (
                  <RatingScale
                    legend="De 0 a 10, quanto você recomendaria a empresa?"
                    options={scoreOptions}
                    low="Nada provável"
                    high="Muito provável"
                    value={field.state.value}
                    error={fieldError(field.state.meta.errors)}
                    onChange={field.handleChange}
                  />
                )}
              </form.Field>
            ) : null}
            {feedbackStepRatings[step].map(({ key, question }) => (
              <form.Field key={key} name={key}>
                {(field) => (
                  <RatingScale
                    legend={question}
                    options={ratingOptions}
                    low="Muito ruim"
                    high="Excelente"
                    value={field.state.value}
                    error={fieldError(field.state.meta.errors)}
                    onChange={field.handleChange}
                  />
                )}
              </form.Field>
            ))}
            {step === lastStep ? (
              <>
                <form.Field name="topics">
                  {(field) => (
                    <fieldset className="grid gap-2">
                      <legend className="font-semibold">O que mais marcou sua saída?</legend>
                      {feedbackTopics.map((topic) => (
                        <label key={topic} className="flex min-h-11 items-center gap-2">
                          <Checkbox
                            checked={field.state.value.includes(topic)}
                            onCheckedChange={(checked) =>
                              field.handleChange(
                                checked
                                  ? [...field.state.value, topic]
                                  : field.state.value.filter((current) => current !== topic),
                              )
                            }
                          />{" "}
                          {topic}
                        </label>
                      ))}
                    </fieldset>
                  )}
                </form.Field>
                <form.Field name="comment">
                  {(field) => (
                    <div className="grid gap-1.5">
                      <Label htmlFor="employee-comment">O que poderia ser melhor?</Label>
                      <Textarea
                        id="employee-comment"
                        maxLength={800}
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                      />
                      <EmployeeError message={fieldError(field.state.meta.errors)} />
                    </div>
                  )}
                </form.Field>
                <form.Field name="anonymous">
                  {(field) => (
                    <label className="flex min-h-11 items-center gap-2">
                      <Checkbox checked={field.state.value} onCheckedChange={field.handleChange} />{" "}
                      Omitir meu nome em relatórios
                    </label>
                  )}
                </form.Field>
              </>
            ) : null}
            <EmployeeError message={write.error?.message} />
            <div className="flex flex-wrap gap-2">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setAttempted(false);
                    setStep(step - 1);
                  }}
                >
                  Voltar
                </Button>
              ) : null}
              <Button type="submit" disabled={write.isPending}>
                {step < lastStep ? "Próxima" : write.isPending ? "Enviando…" : "Enviar feedback"}
              </Button>
            </div>
          </form>
        </EmployeePanel>
      )}
    </div>
  );
}
