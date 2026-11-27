import { brazilTimezone } from "@offboard/employee";
import type { CareerInterview } from "@/entities/career";
import type { EmployeeJourney } from "@/entities/employee";

export type AgendaItem = {
  id: string;
  kind: "interview" | "task";
  day: string;
  time: string;
  title: string;
  detail: string;
  done: boolean;
  interviewId: string | null;
};

const modeLabels = { video: "Vídeo", in_person: "Presencial", phone: "Telefone" } as const;

const dayParts = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: brazilTimezone,
});

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function dayKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthRange(month: Date) {
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);

  return {
    from: dayKey(new Date(month.getFullYear(), month.getMonth(), 1)),
    to: dayKey(last),
  };
}

function interviewItem(interview: CareerInterview) {
  const parts = Object.fromEntries(
    dayParts.formatToParts(new Date(interview.startsAt)).map(({ type, value }) => [type, value]),
  );

  return {
    id: `interview-${interview.id}`,
    kind: "interview",
    day: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    title: `Entrevista: ${interview.job.title}`,
    detail: `${interview.job.company} · ${modeLabels[interview.mode]} · com ${interview.with}`,
    done: false,
    interviewId: interview.id,
  } satisfies AgendaItem;
}

function taskItems(checklist: EmployeeJourney["checklist"]) {
  return checklist.flatMap((task) =>
    task.dueDate
      ? [
          {
            id: `task-${task.id}`,
            kind: "task" as const,
            day: task.dueDate,
            time: "",
            title: task.title,
            detail: task.description ?? "",
            done: task.status === "done",
            interviewId: null,
          },
        ]
      : [],
  );
}

function byTime(a: AgendaItem, b: AgendaItem) {
  if (a.time === b.time) return a.title.localeCompare(b.title, "pt-BR");

  return a.time.localeCompare(b.time);
}

export function agendaItems(
  checklist: EmployeeJourney["checklist"],
  interviews: CareerInterview[],
) {
  return [...taskItems(checklist), ...interviews.map(interviewItem)].sort(byTime);
}

export function itemsOn(items: AgendaItem[], day: string) {
  return items.filter((item) => item.day === day);
}

export function parseDay(day: string) {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8)));
}

export function daysWithItems(items: AgendaItem[]) {
  return [...new Set(items.map((item) => item.day))].map(parseDay);
}
