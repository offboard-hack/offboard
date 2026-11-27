import Calendar01Icon from "@hugeicons/core-free-icons/Calendar01Icon";
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { ptBR } from "date-fns/locale";
import { useState } from "react";
import { careerInterviewsQuery, useRemoveInterview } from "@/entities/career";
import type { EmployeeAccount, EmployeeJourney } from "@/entities/employee";
import { todayAtWorkspace } from "@/entities/offboarding";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import { Calendar } from "@/shared/ui/shadcn/calendar";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/shared/ui/shadcn/item";
import { EmployeeEmpty, EmployeeError, EmployeePanel } from "./ui";
import { agendaItems, dayKey, daysWithItems, itemsOn, monthRange, parseDay } from "./agenda";

const dayLabel = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function EmployeeAgenda({
  account,
  journey,
}: {
  account: EmployeeAccount;
  journey: EmployeeJourney;
}) {
  const [month, setMonth] = useState(() => parseDay(todayAtWorkspace()));
  const [selected, setSelected] = useState(() => parseDay(todayAtWorkspace()));
  const { from, to } = monthRange(month);
  const remove = useRemoveInterview(account);
  const interviews = useQuery(careerInterviewsQuery(account, from, to));
  const items = agendaItems(journey.checklist, interviews.data ?? []);
  const chosen = itemsOn(items, dayKey(selected));

  return (
    <EmployeePanel
      title="Agenda"
      description="Entrevistas que você marcou em Candidaturas e atividades da saída com data."
    >
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <Calendar
          mode="single"
          locale={ptBR}
          showOutsideDays={false}
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={(day) => day && setSelected(day)}
          modifiers={{ scheduled: daysWithItems(items) }}
          modifiersClassNames={{ scheduled: "font-bold underline underline-offset-4" }}
          className="mx-auto border p-3 [--cell-size:--spacing(10)] md:mx-0"
        />
        <div className="grid content-start gap-2">
          <h3 className="text-sm font-semibold capitalize">{dayLabel.format(selected)}</h3>
          {chosen.length === 0 ? <EmployeeEmpty>Nada marcado para este dia.</EmployeeEmpty> : null}
          <ul className="divide-y">
            {chosen.map((item) => {
              const { interviewId } = item;

              return (
                <li key={item.id}>
                  <Item size="sm">
                    <ItemMedia variant="icon">
                      <HugeiconsIcon
                        icon={item.kind === "interview" ? Calendar01Icon : CheckListIcon}
                        aria-hidden="true"
                      />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="block wrap-anywhere">{item.title}</ItemTitle>
                      {item.detail ? (
                        <ItemDescription className="line-clamp-none wrap-anywhere">
                          {item.detail}
                        </ItemDescription>
                      ) : null}
                    </ItemContent>
                    {item.time ? <Badge variant="secondary">{item.time}</Badge> : null}
                    {item.done ? <Badge variant="status-success">Concluída</Badge> : null}
                    {interviewId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(interviewId)}
                      >
                        Remover
                      </Button>
                    ) : null}
                  </Item>
                </li>
              );
            })}
          </ul>
          <EmployeeError message={remove.error?.message} />
        </div>
      </div>
    </EmployeePanel>
  );
}
