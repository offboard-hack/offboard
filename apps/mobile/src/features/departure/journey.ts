import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import FirstAidKitIcon from "@hugeicons/core-free-icons/FirstAidKitIcon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import Package01Icon from "@hugeicons/core-free-icons/Package01Icon";
import Task01Icon from "@hugeicons/core-free-icons/Task01Icon";
import type { Href } from "expo-router";

import {
  type Departure,
  getBookingDescription,
  getHandoffCount,
  type useDeparturePlan,
} from "./departure-data";

export function getJourney(state: Departure, plan: ReturnType<typeof useDeparturePlan>) {
  const { departure, equipment, handoff, demo } = plan;
  const shared = getHandoffCount(state, handoff);

  const steps = [
    {
      href: "/passagem",
      icon: Task01Icon,
      title: "Passar seu trabalho",
      description: shared
        ? `${shared} de ${handoff.length} itens revisados`
        : handoff.length
          ? "Revise os itens da passagem"
          : "Nenhum item informado pelo RH",
      complete: handoff.length > 0 && shared === handoff.length,
      waiting: handoff.length === 0,
    },
    {
      href: "/equipamentos",
      icon: Package01Icon,
      title: "Devolver equipamentos",
      description: state.booking
        ? `Agendado · ${getBookingDescription(state.booking)}`
        : equipment.length
          ? `Escolha como devolver · ${equipment.length} itens`
          : "Nenhum item informado pelo RH",
      complete: false,
      waiting: equipment.length === 0,
    },
    {
      href: "/exame",
      icon: FirstAidKitIcon,
      title: "Fazer o exame demissional",
      description: state.examAttended
        ? "Comparecimento registrado"
        : departure.exam
          ? `${departure.exam.shortDate} · ${departure.exam.clinic}`
          : "Agendamento ainda não informado",
      complete: state.examAttended,
      waiting: !departure.exam,
    },
    {
      href: "/rescisao",
      icon: File01Icon,
      title: "Receber o termo de rescisão",
      description: `Previsto até ${departure.deadlineShort}`,
      complete: false,
      waiting: true,
    },
  ] satisfies Array<{
    href: Href;
    icon: typeof Task01Icon;
    title: string;
    description: string;
    complete: boolean;
    waiting: boolean;
  }>;

  const feedback = {
    href: "/feedback",
    icon: Message01Icon,
    title: "Avaliar minha saída",
    description: state.feedback
      ? demo
        ? "Resposta salva neste dispositivo"
        : "Resposta salva"
      : "Pesquisa opcional sobre a sua experiência",
    complete: state.feedback !== null,
  } satisfies {
    href: Href;
    icon: typeof Message01Icon;
    title: string;
    description: string;
    complete: boolean;
  };

  return {
    open: steps.filter((step) => !step.complete && !step.waiting),
    complete: steps.filter((step) => step.complete),
    waiting: steps.filter((step) => step.waiting),
    total: steps.length,
    feedback,
  };
}
