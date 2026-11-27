import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import FirstAidKitIcon from "@hugeicons/core-free-icons/FirstAidKitIcon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import Package01Icon from "@hugeicons/core-free-icons/Package01Icon";
import Task01Icon from "@hugeicons/core-free-icons/Task01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { employeeDate, type EmployeeState } from "@offboard/employee";
import {
  bookingFormSchema,
  bookingSchema,
  feedbackTopics,
  type BookingForm,
} from "@offboard/employee/departure";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  type EmployeeAccount,
  type EmployeeJourney,
  useEmployeeChecklistWrite,
  useEmployeeTrackingCode,
  useEmployeeWrite,
} from "@/entities/employee";
import { todayAtWorkspace } from "@/entities/offboarding";
import { PortalFilter } from "@/shared/ui/select";
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
  const { booking, handoffCompleted, examAttended, feedback } = state.value;

  const equipmentReceived =
    journey.equipment.length > 0 && journey.equipment.every((item) => item.received);

  const reviewed = plan.handoff.filter(({ id }) => handoffCompleted.includes(id)).length;
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
        : booking || journey.equipment.length === 0
          ? "tracking"
          : "pending",
      description: equipmentReceived
        ? "Recebimento confirmado"
        : booking
          ? `Agendado para ${employeeDate(booking.day, dayFormat)}`
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
      description: `Prazo informado pelo RH: ${deadlineLabel(journey)}`,
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
          {items.map(({ to, title, icon, description }) => (
            <li key={to}>
              <Item size="sm" render={<Link to="/colaborador" search={{ tela: to }} />}>
                <ItemMedia variant="icon">
                  <HugeiconsIcon icon={icon} aria-hidden="true" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="block wrap-anywhere">{title}</ItemTitle>
                  <ItemDescription>{description}</ItemDescription>
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

export function Equipment({ account, journey, state }: DepartureProps) {
  const [editing, setEditing] = useState(false);
  const { booking } = state.value;
  const { bookingDays, officeAddress } = journey.plan;
  const { equipment } = journey;
  const pending = equipment.filter((item) => !item.received).length;
  const allReceived = equipment.length > 0 && pending === 0;
  const canBook = pending > 0 && bookingDays.length > 0;

  return (
    <div className="space-y-5">
      {allReceived ? (
        <EmployeePanel title="Devolução concluída">
          <p>A equipe confirmou o recebimento de todos os bens.</p>
        </EmployeePanel>
      ) : null}
      {booking && pending > 0 && (!editing || !canBook) ? (
        <EmployeePanel
          title="Devolução agendada"
          description={booking.method === "pickup" ? "Coleta em casa" : "Entrega no escritório"}
        >
          <p className="font-bold">
            {employeeDate(booking.day, dayFormat)} ·{" "}
            {booking.slot === "morning" ? "9h às 12h" : "13h às 17h"}
          </p>
          <p className="text-muted-foreground">
            {booking.method === "pickup" ? booking.address : officeAddress}
          </p>
          {canBook ? (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Alterar agendamento
            </Button>
          ) : null}
        </EmployeePanel>
      ) : null}
      {pending > 0 && !allReceived ? (
        <TrackingCodeInput account={account} trackingCode={journey.trackingCode} />
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
              ) : null}
            </li>
          ))}
        </ul>
      </EmployeePanel>
      {canBook && (!booking || editing) ? (
        <BookingForm
          account={account}
          journey={journey}
          state={state}
          close={() => setEditing(false)}
        />
      ) : pending > 0 && !canBook ? (
        <p className="text-sm text-muted-foreground">
          O RH ainda não disponibilizou datas para devolução.
        </p>
      ) : null}
    </div>
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

function BookingForm({ account, journey, state, close }: DepartureProps & { close: () => void }) {
  const write = useEmployeeWrite(account);
  const { booking } = state.value;
  const { bookingDays, officeAddress } = journey.plan;

  const initial: BookingForm = {
    method: booking?.method === "office" && officeAddress ? "office" : "pickup",
    day: booking && bookingDays.includes(booking.day) ? booking.day : null,
    slot: booking?.slot ?? null,
    address: booking?.method === "pickup" ? booking.address : "",
  };

  const form = useForm({
    defaultValues: initial,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: bookingFormSchema },
    onSubmit: ({ value }) =>
      write.mutate(
        { ...state, value: { ...state.value, booking: bookingSchema.parse(value) } },
        { onSuccess: close },
      ),
  });

  return (
    <EmployeePanel title={booking ? "Alterar agendamento" : "Agendar devolução"}>
      <form
        className="grid gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <form.Field name="method">
            {(field) => (
              <div className="grid content-start gap-2">
                <Label htmlFor="booking-method">Como prefere devolver?</Label>
                <PortalFilter
                  id="booking-method"
                  label="Como prefere devolver?"
                  value={field.state.value}
                  disabled={write.isPending}
                  className="w-full"
                  items={[
                    { value: "pickup", label: "Coleta em casa" },
                    ...(officeAddress
                      ? [{ value: "office", label: "Entregar no escritório" }]
                      : []),
                  ]}
                  onChange={(value) => {
                    if (value === "pickup" || value === "office") field.handleChange(value);
                  }}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="day">
            {(field) => {
              const error = field.state.meta.errors[0]?.message;

              return (
                <div className="grid content-start gap-2">
                  <Label htmlFor="booking-day">Dia da devolução</Label>
                  <PortalFilter
                    id="booking-day"
                    label="Dia da devolução"
                    value={field.state.value ?? ""}
                    invalid={Boolean(error)}
                    describedBy={error ? "booking-day-error" : undefined}
                    disabled={write.isPending}
                    className="w-full"
                    items={[
                      { value: "", label: "Escolha o dia" },
                      ...bookingDays.map((day) => ({
                        value: day,
                        label: employeeDate(day, dayFormat),
                      })),
                    ]}
                    onChange={(value) => field.handleChange(value || null)}
                  />
                  <EmployeeError id="booking-day-error" message={error} />
                </div>
              );
            }}
          </form.Field>
          <form.Field name="slot">
            {(field) => {
              const error = field.state.meta.errors[0]?.message;

              return (
                <div className="grid content-start gap-2">
                  <Label htmlFor="booking-slot">Horário</Label>
                  <PortalFilter
                    id="booking-slot"
                    label="Horário"
                    value={field.state.value ?? ""}
                    invalid={Boolean(error)}
                    describedBy={error ? "booking-slot-error" : undefined}
                    disabled={write.isPending}
                    className="w-full"
                    items={[
                      { value: "", label: "Escolha o horário" },
                      { value: "morning", label: "9h às 12h" },
                      { value: "afternoon", label: "13h às 17h" },
                    ]}
                    onChange={(value) =>
                      field.handleChange(
                        value === "morning" || value === "afternoon" ? value : null,
                      )
                    }
                  />
                  <EmployeeError id="booking-slot-error" message={error} />
                </div>
              );
            }}
          </form.Field>
        </div>
        <form.Subscribe selector={(formState) => formState.values.method}>
          {(method) =>
            method === "pickup" ? (
              <form.Field name="address">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor="pickup-address">Endereço da coleta</Label>
                    <Input
                      id="pickup-address"
                      value={field.state.value}
                      disabled={write.isPending}
                      autoComplete="street-address"
                      placeholder="Rua, número e cidade"
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={field.state.meta.errors.length > 0}
                      aria-describedby={
                        field.state.meta.errors.length > 0 ? "pickup-address-error" : undefined
                      }
                    />
                    <EmployeeError
                      id="pickup-address-error"
                      message={field.state.meta.errors[0]?.message}
                    />
                  </div>
                )}
              </form.Field>
            ) : (
              <p className="text-sm text-muted-foreground">{officeAddress}</p>
            )
          }
        </form.Subscribe>
        <EmployeeError message={write.error?.message} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={write.isPending}>
            {write.isPending ? "Salvando…" : "Salvar agendamento"}
          </Button>
          {booking ? (
            <Button type="button" variant="ghost" onClick={close} disabled={write.isPending}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </form>
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
