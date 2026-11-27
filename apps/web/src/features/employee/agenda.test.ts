import { describe, expect, it } from "vitest";
import type { CareerInterview } from "@/entities/career";
import type { EmployeeJourney } from "@/entities/employee";
import { agendaItems, dayKey, daysWithItems, itemsOn, monthRange, parseDay } from "./agenda";

const checklist = [
  {
    id: "t1",
    title: "Devolver crachá",
    description: "Na recepção",
    dueDate: "2026-12-03",
    dueTime: "08:15",
    status: "done",
    action: "check",
  },
  {
    id: "t2",
    title: "Assinar termo",
    description: null,
    dueDate: "2026-12-03",
    dueTime: null,
    status: "todo",
    action: "check",
  },
  {
    id: "t3",
    title: "Sem data",
    description: null,
    dueDate: null,
    dueTime: null,
    status: "todo",
    action: "check",
  },
] satisfies EmployeeJourney["checklist"];

function interview(id: string, startsAt: string, mode: CareerInterview["mode"]) {
  return {
    id,
    applicationId: "a1",
    startsAt,
    mode,
    with: "Ana",
    notes: "",
    job: { title: "Designer", company: "Acme" },
  } satisfies CareerInterview;
}

describe("builds the agenda", () => {
  const items = agendaItems(checklist, [
    interview("i2", "2026-12-03T20:00:00.000Z", "phone"),
    interview("i1", "2026-12-03T13:30:00.000Z", "in_person"),
    interview("i3", "2026-12-04T02:30:00.000Z", "video"),
  ]);

  it("keeps only dated tasks and places interviews in the Brasília day", () => {
    expect(items.map(({ id, day, time }) => [id, day, time])).toEqual([
      ["task-t2", "2026-12-03", ""],
      ["task-t1", "2026-12-03", "08:15"],
      ["interview-i1", "2026-12-03", "10:30"],
      ["interview-i2", "2026-12-03", "17:00"],
      ["interview-i3", "2026-12-03", "23:30"],
    ]);
  });

  it("describes tasks and interviews", () => {
    expect(items[0]).toMatchObject({ kind: "task", done: false, detail: "" });
    expect(items[1]).toMatchObject({ done: true, detail: "Na recepção" });
    expect(items[2]).toMatchObject({
      kind: "interview",
      title: "Entrevista: Designer",
      detail: "Acme · Presencial · com Ana",
      interviewId: "i1",
    });
    expect(items[3].detail).toBe("Acme · Telefone · com Ana");
    expect(items[4].detail).toBe("Acme · Vídeo · com Ana");
  });

  it("filters by day and lists the marked days", () => {
    expect(itemsOn(items, "2026-12-03")).toHaveLength(5);
    expect(itemsOn(items, "2026-12-04")).toEqual([]);
    expect(daysWithItems(items)).toEqual([new Date(2026, 11, 3)]);
  });

  it("orders timed items by hour and breaks ties by title", () => {
    const sorted = agendaItems(
      [],
      [
        interview("a", "2026-12-03T15:00:00.000Z", "video"),
        interview("b", "2026-12-03T14:00:00.000Z", "video"),
        interview("c", "2026-12-03T14:00:00.000Z", "video"),
      ],
    );

    expect(sorted.map(({ id }) => id)).toEqual(["interview-b", "interview-c", "interview-a"]);
  });
});

describe("handles calendar days", () => {
  it("parses a day as local midnight", () => {
    expect(parseDay("2026-12-03")).toEqual(new Date(2026, 11, 3));
  });

  it("formats a local day key", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("returns the first and last day of the month", () => {
    expect(monthRange(new Date(2026, 1, 14))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
