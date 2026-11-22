export type SeedStatus = "done" | "in_progress" | "todo";

export type SeedCase = {
  name: string;
  role: string;
  department: string;
  deadline: string;
  tasks: readonly (readonly [
    team: string,
    title: string,
    status: SeedStatus,
    phase: string | null,
  ])[];
};

export const seedCases = [
  {
    name: "Marina Lopes",
    role: "Analista de marketing",
    department: "Marketing",
    deadline: "2026-11-13",
    tasks: [
      ["RH e DP", "Conferir estabilidades", "done", "pre"],
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done", "pre"],
      ["RH e DP", "Enviar convite do app Offboard", "done", "d0"],
      ["RH e DP", "Avisar sobre a continuidade do plano de saúde", "done", "first-week"],
      ["RH e DP", "Fechar ponto e banco de horas", "done", "d0"],
      ["RH e DP", "Agendar exame demissional", "done", "pre"],
      ["RH e DP", "Calcular a rescisão", "in_progress", "first-week"],
      ["RH e DP", "Enviar desligamento ao eSocial", "todo", "first-week"],
      ["RH e DP", "Recolher FGTS e multa rescisória", "todo", "first-week"],
      ["RH e DP", "Pagar a rescisão e enviar os documentos", "todo", "first-week"],
      ["RH e DP", "Encerrar os vales", "todo", "second-week"],
      ["TI", "Bloquear acessos no último dia", "done", "d0"],
      ["TI", "Transferir arquivos e e-mail", "done", "first-week"],
      ["TI", "Cancelar licenças", "done", "first-week"],
      ["TI", "Coletar notebook e acessórios", "in_progress", "first-week"],
      ["TI", "Apagar dados e devolver ao estoque", "todo", "second-week"],
      ["Gestão", "Montar o mapa de passagem de trabalho", "done", "pre"],
      ["Gestão", "Confirmar a passagem com Marina", "in_progress", "first-week"],
      ["Gestão", "Trocar o responsável no CRM", "done", "first-week"],
      ["Gestão", "Avisar clientes e fornecedores", "done", "first-week"],
      ["Financeiro", "Aprovar reembolsos pendentes", "in_progress", "second-week"],
      ["Jurídico", "Verificar procurações e certificados", "done", "second-week"],
      ["Jurídico", "Transferir contas externas", "todo", "first-week"],
      ["Facilities", "Desativar crachá e acesso", "done", "d0"],
      ["Pessoa desligada", "Confirmar itens e agendar a coleta", "done", "first-week"],
      ["Pessoa desligada", "Fazer o exame demissional", "todo", "first-week"],
      ["Pessoa desligada", "Responder à pesquisa de desligamento", "todo", "follow-up"],
    ],
  },
  {
    name: "Rafael Mendes",
    role: "Engenheiro de software",
    department: "Tecnologia",
    deadline: "2026-11-16",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done", "pre"],
      ["RH e DP", "Agendar exame demissional", "done", "pre"],
      ["RH e DP", "Enviar o termo de rescisão", "todo", "first-week"],
      ["TI", "Transferir repositórios e acessos", "in_progress", "first-week"],
      ["TI", "Recolher equipamentos", "todo", "first-week"],
      ["Gestão", "Confirmar a passagem de trabalho", "done", "pre"],
    ],
  },
  {
    name: "Bianca Souza",
    role: "Coordenadora de operações",
    department: "Operações",
    deadline: "2026-11-18",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done", "pre"],
      ["RH e DP", "Fechar ponto e banco de horas", "in_progress", "d0"],
      ["RH e DP", "Enviar o termo de rescisão", "todo", "first-week"],
      ["TI", "Recolher equipamentos", "todo", "first-week"],
      ["Gestão", "Repasse das rotinas de operação", "done", "first-week"],
    ],
  },
  {
    name: "André Lima",
    role: "Analista financeiro",
    department: "Financeiro",
    deadline: "2026-11-19",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done", "pre"],
      ["RH e DP", "Agendar exame demissional", "todo", "pre"],
      ["Financeiro", "Transferir aprovações de pagamentos", "in_progress", "first-week"],
      ["TI", "Desativar acessos", "todo", "d0"],
    ],
  },
  {
    name: "Nina Castro",
    role: "Designer de produto",
    department: "Produto",
    deadline: "2026-11-23",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done", "pre"],
      ["RH e DP", "Agendar exame demissional", "todo", "pre"],
      ["TI", "Transferir acesso aos projetos", "todo", "first-week"],
      ["Gestão", "Confirmar a passagem de trabalho", "in_progress", "pre"],
    ],
  },
] as const satisfies readonly SeedCase[];
