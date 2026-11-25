import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import HeadphonesIcon from "@hugeicons/core-free-icons/HeadphonesIcon";
import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import Plug01Icon from "@hugeicons/core-free-icons/Plug01Icon";
import { brazilTimezone, employeeDate } from "@offboard/employee";
import { z } from "zod";

import {
  bookingDayOptions,
  demoDaySchema,
  departureSchema,
  initialDeparture,
  type Booking,
  type Departure,
} from "@offboard/employee/departure";

export {
  bookingDayOptions,
  bookingSlotOptions,
  bookingSchema,
  bookingFormSchema,
  feedbackFormSchema,
  responseOptions,
  type Booking,
  type BookingForm,
  type Departure,
  type FeedbackForm,
} from "@offboard/employee/departure";

import { useEmployeeJourney } from "../../shared/employee-journey";
import { useLocalData, type WriteVisibility } from "../../shared/storage";

export const departure = {
  company: "Aurora Tecnologia",
  currentDay: "segunda-feira, 23 de novembro",
  deadline: "27 de novembro",
  deadlineShort: "27 nov",
  lastDay: "17 de novembro de 2026",
  officeAddress: "Recepção da Aurora · Rua Fictícia, 250, São Paulo",
  exam: {
    date: "Quarta-feira, 25 de novembro, às 9h",
    shortDate: "25 nov, às 9h",
    clinic: "Clínica Vida Ocupacional",
    address: "Rua Clínica, 120, São Paulo",
  },
};

export const handoff = [
  { id: "calendar", title: "Calendário de campanhas", owner: "Caio", area: "Marketing" },
  { id: "reports", title: "Relatórios de desempenho", owner: "Júlio", area: "Marketing" },
  { id: "assets", title: "Arquivos e materiais da marca", owner: "Caio", area: "Marketing" },
  {
    id: "budget",
    title: "Planilha de orçamento do trimestre",
    owner: "Beatriz",
    area: "Financeiro",
  },
  { id: "partners", title: "Contatos de parceiros", owner: "Júlio", area: "Marketing" },
  { id: "briefs", title: "Briefings em andamento", owner: "Caio", area: "Marketing" },
];

export const equipment = [
  { title: "Notebook", model: "Dell Latitude 5440", code: "AUR-2673", icon: LaptopIcon },
  { title: "Carregador", model: "USB-C 65 W", code: "AUR-1592", icon: Plug01Icon },
  { title: "Headset", model: "Jabra Evolve2", code: "AUR-9511", icon: HeadphonesIcon },
  { title: "Monitor", model: "LG 24”", code: "AUR-8430", icon: ComputerIcon },
];

export const bookingDays = {
  "24": { weekday: "Ter", label: "24 nov", fullLabel: "terça-feira, 24 de novembro" },
  "25": { weekday: "Qua", label: "25 nov", fullLabel: "quarta-feira, 25 de novembro" },
  "26": { weekday: "Qui", label: "26 nov", fullLabel: "quinta-feira, 26 de novembro" },
  "27": { weekday: "Sex", label: "27 nov", fullLabel: "sexta-feira, 27 de novembro" },
} satisfies Record<
  z.infer<typeof demoDaySchema>,
  { weekday: string; label: string; fullLabel: string }
>;

export const bookingSlots = {
  morning: "9h às 12h",
  afternoon: "13h às 17h",
} satisfies Record<"morning" | "afternoon", string>;

export function useDeparture(visibility: WriteVisibility = "optimistic") {
  return useLocalData("departure-v1", departureSchema, initialDeparture, visibility);
}

export function getHandoffCount(state: Departure, handoff: ReadonlyArray<{ id: string }>) {
  return handoff.filter((task) => state.handoffCompleted.includes(task.id)).length;
}

export function getBookingDescription(booking: Booking) {
  return `${getBookingDay(booking.day).label} · ${bookingSlots[booking.slot]}`;
}

export function getBookingMethod(booking: Booking) {
  return booking.method === "pickup" ? "Coleta em casa" : "Entrega no escritório";
}

export function getBookingDay(day: string) {
  const demo = demoDaySchema.safeParse(day);

  if (demo.success) return bookingDays[demo.data];

  return {
    weekday: employeeDate(day, { weekday: "short" }),
    label: employeeDate(day, { month: "short", day: "numeric" }),
    fullLabel: employeeDate(day, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  };
}

export function useDeparturePlan() {
  const journey = useEmployeeJourney();

  if (!journey)
    return {
      departure,
      equipment: equipment.map((item) => ({ ...item, received: false })),
      handoff,
      bookingDays: bookingDayOptions,
      demo: true,
    };

  const { plan } = journey;

  const exam = plan.exam && {
    clinic: plan.exam.clinic,
    address: plan.exam.address,
    date: `${employeeDate(plan.exam.day, { weekday: "long", day: "numeric", month: "long" })}, às ${plan.exam.time}`,
    shortDate: `${employeeDate(plan.exam.day, { day: "numeric", month: "short" })}, às ${plan.exam.time}`,
  };

  return {
    demo: false,
    bookingDays: plan.bookingDays,
    handoff: plan.handoff,
    equipment: journey.equipment.map((item) => ({ ...item, icon: ComputerIcon })),
    departure: {
      company: plan.company ?? "sua empresa",
      currentDay: new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: brazilTimezone,
      }).format(),
      deadline: employeeDate(journey.deadline, { day: "numeric", month: "long", year: "numeric" }),
      deadlineShort: employeeDate(journey.deadline, { day: "numeric", month: "short" }),
      lastDay:
        plan.lastDay &&
        employeeDate(plan.lastDay, { day: "numeric", month: "long", year: "numeric" }),
      officeAddress: plan.officeAddress,
      exam,
    },
  };
}
