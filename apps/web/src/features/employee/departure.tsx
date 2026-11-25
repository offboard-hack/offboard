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
  feedbackFormSchema,
  responseOptions,
  type BookingForm,
  type FeedbackForm,
} from "@offboard/employee/departure";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  type EmployeeAccount,
  type EmployeeJourney,
  useEmployeeChecklistWrite,
  useEmployeeWrite,
} from "@/entities/employee";
import { todayAtWorkspace } from "@/entities/offboarding";
import { PortalFilter } from "@/shared/ui/select";
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

const assessmentOptions = [1, 2, 3, 4, 5] as const;

const selectedAnswer =
  "aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground";

const ratedQuestions = [
  { key: "clarity", text: "A comunicação foi clara?" },
  { key: "respect", text: "Você se sentiu respeitado?" },
] as const;

export function Feedback({ account, state }: { account: EmployeeAccount; state: DepartureState }) {
  const write = useEmployeeWrite(account);
  const submitted = state.value.feedback;
  const recommendationInput = useRef<HTMLInputElement>(null);

  const initial: FeedbackForm = {
    anonymous: true,
    assessment: null,
    clarity: null,
    respect: null,
    comment: "",
    recommendation: "",
  };

  const form = useForm({
    defaultValues: initial,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: feedbackFormSchema },
    onSubmitInvalid: ({ formApi }) => {
      if (formApi.getFieldMeta("recommendation")?.errors.length) {
        recommendationInput.current?.focus();
      }
    },
    onSubmit: ({ value }) => {
      const parsed = feedbackFormSchema.parse(value);
      const recommendation = parsed.recommendation === "" ? null : Number(parsed.recommendation);

      write.mutate({
        ...state,
        value: { ...state.value, feedback: { ...parsed, recommendation } },
      });
    },
  });

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
            <form.Field name="anonymous">
              {(field) => (
                <label className="flex min-h-11 items-center gap-2">
                  <Checkbox checked={field.state.value} onCheckedChange={field.handleChange} />{" "}
                  Omitir meu nome em relatórios
                </label>
              )}
            </form.Field>
            <form.Field name="assessment">
              {(field) => (
                <fieldset className="space-y-2">
                  <legend className="font-semibold">Qual nota você dá ao processo?</legend>
                  <ToggleGroup
                    aria-label="Nota do processo"
                    variant="outline"
                    className="max-w-full flex-wrap"
                    value={field.state.value === null ? [] : [String(field.state.value)]}
                    onValueChange={([next]) =>
                      field.handleChange(
                        assessmentOptions.find((rating) => String(rating) === next) ?? null,
                      )
                    }
                  >
                    {assessmentOptions.map((rating) => (
                      <ToggleGroupItem
                        key={rating}
                        value={String(rating)}
                        className={selectedAnswer}
                      >
                        {rating}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </fieldset>
              )}
            </form.Field>
            {ratedQuestions.map(({ key, text }) => (
              <form.Field key={key} name={key}>
                {(field) => (
                  <fieldset className="space-y-2">
                    <legend className="font-semibold">{text}</legend>
                    <ToggleGroup
                      aria-label={text}
                      variant="outline"
                      className="max-w-full flex-wrap"
                      value={field.state.value === null ? [] : [field.state.value]}
                      onValueChange={([next]) =>
                        field.handleChange(
                          responseOptions.find((answer) => answer === next) ?? null,
                        )
                      }
                    >
                      {responseOptions.map((answer) => (
                        <ToggleGroupItem key={answer} value={answer} className={selectedAnswer}>
                          {answer}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </fieldset>
                )}
              </form.Field>
            ))}
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
                </div>
              )}
            </form.Field>
            <form.Field name="recommendation">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor="employee-recommendation">
                    De 0 a 10, quanto você recomendaria a empresa?
                  </Label>
                  <Input
                    ref={recommendationInput}
                    id="employee-recommendation"
                    className="max-w-28"
                    inputMode="numeric"
                    maxLength={2}
                    aria-invalid={field.state.meta.errors.length > 0 || undefined}
                    aria-describedby={
                      field.state.meta.errors.length > 0
                        ? "employee-recommendation-error"
                        : undefined
                    }
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <EmployeeError
                    id="employee-recommendation-error"
                    message={field.state.meta.errors[0]?.message}
                  />
                </div>
              )}
            </form.Field>
            <form.Subscribe selector={(formState) => formState.errorMap.onDynamic}>
              {(validation) =>
                validation ? <EmployeeError message={validation.form?.[0]?.message} /> : null
              }
            </form.Subscribe>
            <EmployeeError message={write.error?.message} />
            <Button type="submit" className="justify-self-start" disabled={write.isPending}>
              {write.isPending ? "Enviando…" : "Enviar feedback"}
            </Button>
          </form>
        </EmployeePanel>
      )}
    </div>
  );
}
