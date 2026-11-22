export type SeedStatus = "done" | "in_progress" | "todo";

export type SeedSubtask = { title: string; done: boolean };

export type SeedTask = {
  team: string;
  title: string;
  status: SeedStatus;
  description?: string;
  dueDate?: string;
  subtasks?: SeedSubtask[];
};

export type SeedCase = {
  name: string;
  role: string;
  department: string;
  deadline: string;
  tasks: readonly SeedTask[];
};

export const seedCases: readonly SeedCase[] = [
  {
    name: "Marina Lopes",
    role: "Analista de marketing",
    department: "Marketing",
    deadline: "2026-11-13",
    tasks: [
      { team: "RH e DP", title: "Conferir estabilidades", status: "done" },
      {
        team: "RH e DP",
        title: "Comunicar desligamento e aviso prévio",
        status: "done",
        description: "Agendar reunião com o gestor e comunicar formalmente o desligamento.",
      },
      { team: "RH e DP", title: "Enviar convite do app Offboard", status: "done" },
      { team: "RH e DP", title: "Avisar sobre a continuidade do plano de saúde", status: "done" },
      {
        team: "RH e DP",
        title: "Fechar ponto e banco de horas",
        status: "done",
        description: "Exportar relatório do sistema de ponto e validar saldo de banco de horas.",
      },
      {
        team: "RH e DP",
        title: "Agendar exame demissional",
        status: "done",
        dueDate: "2026-11-10",
      },
      {
        team: "RH e DP",
        title: "Calcular a rescisão",
        status: "in_progress",
        dueDate: "2026-11-13",
        subtasks: [
          { title: "Levantar saldo de férias", done: true },
          { title: "Calcular 13º proporcional", done: true },
          { title: "Calcular multa FGTS", done: false },
          { title: "Validar com o financeiro", done: false },
        ],
      },
      {
        team: "RH e DP",
        title: "Enviar desligamento ao eSocial",
        status: "todo",
        dueDate: "2026-11-13",
      },
      { team: "RH e DP", title: "Recolher FGTS e multa rescisória", status: "todo" },
      {
        team: "RH e DP",
        title: "Pagar a rescisão e enviar os documentos",
        status: "todo",
        dueDate: "2026-11-13",
      },
      { team: "RH e DP", title: "Encerrar os vales", status: "todo" },
      {
        team: "TI",
        title: "Bloquear acessos no último dia",
        status: "done",
        description: "Desativar conta no Google Workspace, Slack, VPN e demais ferramentas.",
        subtasks: [
          { title: "Google Workspace", done: true },
          { title: "Slack", done: true },
          { title: "VPN", done: true },
          { title: "GitHub", done: true },
        ],
      },
      { team: "TI", title: "Transferir arquivos e e-mail", status: "done" },
      { team: "TI", title: "Cancelar licenças", status: "done" },
      {
        team: "TI",
        title: "Coletar notebook e acessórios",
        status: "in_progress",
        description: "Agendar logística reversa com a transportadora.",
      },
      { team: "TI", title: "Apagar dados e devolver ao estoque", status: "todo" },
      { team: "Gestão", title: "Montar o mapa de passagem de trabalho", status: "done" },
      { team: "Gestão", title: "Confirmar a passagem com Marina", status: "in_progress" },
      { team: "Gestão", title: "Trocar o responsável no CRM", status: "done" },
      { team: "Gestão", title: "Avisar clientes e fornecedores", status: "done" },
      { team: "Financeiro", title: "Aprovar reembolsos pendentes", status: "in_progress" },
      { team: "Jurídico", title: "Verificar procurações e certificados", status: "done" },
      { team: "Jurídico", title: "Transferir contas externas", status: "todo" },
      { team: "Facilities", title: "Desativar crachá e acesso", status: "done" },
      { team: "Pessoa desligada", title: "Confirmar itens e agendar a coleta", status: "done" },
      { team: "Pessoa desligada", title: "Fazer o exame demissional", status: "todo" },
      { team: "Pessoa desligada", title: "Responder à pesquisa de desligamento", status: "todo" },
    ],
  },
  {
    name: "Rafael Mendes",
    role: "Engenheiro de software",
    department: "Tecnologia",
    deadline: "2026-11-16",
    tasks: [
      { team: "RH e DP", title: "Comunicar desligamento e aviso prévio", status: "done" },
      { team: "RH e DP", title: "Agendar exame demissional", status: "done" },
      {
        team: "RH e DP",
        title: "Enviar o termo de rescisão",
        status: "todo",
        dueDate: "2026-11-16",
      },
      {
        team: "TI",
        title: "Transferir repositórios e acessos",
        status: "in_progress",
        description: "Transferir ownership dos repositórios e revogar tokens de acesso.",
        subtasks: [
          { title: "Transferir repos do GitHub", done: true },
          { title: "Revogar tokens e SSH keys", done: false },
          { title: "Transferir pipelines de CI/CD", done: false },
        ],
      },
      { team: "TI", title: "Recolher equipamentos", status: "todo" },
      { team: "Gestão", title: "Confirmar a passagem de trabalho", status: "done" },
    ],
  },
  {
    name: "Bianca Souza",
    role: "Coordenadora de operações",
    department: "Operações",
    deadline: "2026-11-18",
    tasks: [
      { team: "RH e DP", title: "Comunicar desligamento e aviso prévio", status: "done" },
      { team: "RH e DP", title: "Fechar ponto e banco de horas", status: "in_progress" },
      {
        team: "RH e DP",
        title: "Enviar o termo de rescisão",
        status: "todo",
        dueDate: "2026-11-18",
      },
      { team: "TI", title: "Recolher equipamentos", status: "todo" },
      { team: "Gestão", title: "Repasse das rotinas de operação", status: "done" },
    ],
  },
  {
    name: "André Lima",
    role: "Analista financeiro",
    department: "Financeiro",
    deadline: "2026-11-19",
    tasks: [
      { team: "RH e DP", title: "Comunicar desligamento e aviso prévio", status: "done" },
      {
        team: "RH e DP",
        title: "Agendar exame demissional",
        status: "todo",
        dueDate: "2026-11-15",
      },
      { team: "Financeiro", title: "Transferir aprovações de pagamentos", status: "in_progress" },
      { team: "TI", title: "Desativar acessos", status: "todo" },
    ],
  },
  {
    name: "Nina Castro",
    role: "Designer de produto",
    department: "Produto",
    deadline: "2026-11-23",
    tasks: [
      { team: "RH e DP", title: "Comunicar desligamento e aviso prévio", status: "done" },
      {
        team: "RH e DP",
        title: "Agendar exame demissional",
        status: "todo",
        dueDate: "2026-11-20",
      },
      { team: "TI", title: "Transferir acesso aos projetos", status: "todo" },
      { team: "Gestão", title: "Confirmar a passagem de trabalho", status: "in_progress" },
    ],
  },
];
