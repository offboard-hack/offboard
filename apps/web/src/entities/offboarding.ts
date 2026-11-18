import { queryOptions } from "@tanstack/react-query";

export type CaseSummary = {
  id: string;
  name: string;
  role: string;
  department: string;
  deadline: string;
  completed: number;
  total: number;
};

export type Task = {
  id: string;
  title: string;
  team: string;
  status: "done" | "inProgress" | "todo";
};

export type OffboardingCase = CaseSummary & { tasks: Task[] };

type CaseFixture = Omit<OffboardingCase, "completed" | "total" | "tasks"> & {
  tasks: [team: string, title: string, status: Task["status"]][];
};

const fixtures: CaseFixture[] = [
  {
    id: "marina-lopes",
    name: "Marina Lopes",
    role: "Analista de marketing",
    department: "Marketing",
    deadline: "2026-11-13",
    tasks: [
      ["RH e DP", "Conferir estabilidades", "done"],
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done"],
      ["RH e DP", "Enviar convite do app Offboard", "done"],
      ["RH e DP", "Avisar sobre a continuidade do plano de saúde", "done"],
      ["RH e DP", "Fechar ponto e banco de horas", "done"],
      ["RH e DP", "Agendar exame demissional", "done"],
      ["RH e DP", "Calcular a rescisão", "inProgress"],
      ["RH e DP", "Enviar desligamento ao eSocial", "todo"],
      ["RH e DP", "Recolher FGTS e multa rescisória", "todo"],
      ["RH e DP", "Pagar a rescisão e enviar os documentos", "todo"],
      ["RH e DP", "Encerrar os vales", "todo"],
      ["TI", "Bloquear acessos no último dia", "done"],
      ["TI", "Transferir arquivos e e-mail", "done"],
      ["TI", "Cancelar licenças", "done"],
      ["TI", "Coletar notebook e acessórios", "inProgress"],
      ["TI", "Apagar dados e devolver ao estoque", "todo"],
      ["Gestão", "Montar o mapa de passagem de trabalho", "done"],
      ["Gestão", "Confirmar a passagem com Marina", "inProgress"],
      ["Gestão", "Trocar o responsável no CRM", "done"],
      ["Gestão", "Avisar clientes e fornecedores", "done"],
      ["Financeiro", "Aprovar reembolsos pendentes", "inProgress"],
      ["Jurídico", "Verificar procurações e certificados", "done"],
      ["Jurídico", "Transferir contas externas", "todo"],
      ["Facilities", "Desativar crachá e acesso", "done"],
      ["Pessoa desligada", "Confirmar itens e agendar a coleta", "done"],
      ["Pessoa desligada", "Fazer o exame demissional", "todo"],
      ["Pessoa desligada", "Responder à pesquisa de desligamento", "todo"],
    ],
  },
  {
    id: "rafael-mendes",
    name: "Rafael Mendes",
    role: "Engenheiro de software",
    department: "Tecnologia",
    deadline: "2026-11-16",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done"],
      ["RH e DP", "Agendar exame demissional", "done"],
      ["RH e DP", "Enviar o termo de rescisão", "todo"],
      ["TI", "Transferir repositórios e acessos", "inProgress"],
      ["TI", "Recolher equipamentos", "todo"],
      ["Gestão", "Confirmar a passagem de trabalho", "done"],
    ],
  },
  {
    id: "bianca-souza",
    name: "Bianca Souza",
    role: "Coordenadora de operações",
    department: "Operações",
    deadline: "2026-11-18",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done"],
      ["RH e DP", "Fechar ponto e banco de horas", "inProgress"],
      ["RH e DP", "Enviar o termo de rescisão", "todo"],
      ["TI", "Recolher equipamentos", "todo"],
      ["Gestão", "Repasse das rotinas de operação", "done"],
    ],
  },
  {
    id: "andre-lima",
    name: "André Lima",
    role: "Analista financeiro",
    department: "Financeiro",
    deadline: "2026-11-19",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done"],
      ["RH e DP", "Agendar exame demissional", "todo"],
      ["Financeiro", "Transferir aprovações de pagamentos", "inProgress"],
      ["TI", "Desativar acessos", "todo"],
    ],
  },
  {
    id: "nina-castro",
    name: "Nina Castro",
    role: "Designer de produto",
    department: "Produto",
    deadline: "2026-11-23",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done"],
      ["RH e DP", "Agendar exame demissional", "todo"],
      ["TI", "Transferir acesso aos projetos", "todo"],
      ["Gestão", "Confirmar a passagem de trabalho", "inProgress"],
    ],
  },
];

export const offboardingDepartments = [...new Set(fixtures.map((item) => item.department))];

export const offboardingTeams = [
  ...new Set(fixtures.flatMap(({ tasks }) => tasks.map(([team]) => team))),
];

async function listOffboardings() {
  return fixtures.map(({ tasks: fixtureTasks, ...employee }) => {
    const tasks = fixtureTasks.map(([team, title, status], index) => ({
      id: `${employee.id}-${index + 1}`,
      team,
      title,
      status,
    }));

    return {
      ...employee,
      tasks,
      completed: tasks.filter((task) => task.status === "done").length,
      total: tasks.length,
    };
  });
}

export const offboardingsQuery = queryOptions({
  queryKey: ["offboardings"],
  queryFn: listOffboardings,
  staleTime: Infinity,
});

const deadlineFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDeadline(isoDate: string) {
  return deadlineFormat.format(new Date(isoDate)).replaceAll(" de ", " ").replace(".", "");
}
