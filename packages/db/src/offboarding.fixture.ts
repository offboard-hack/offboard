export type SeedStatus = "done" | "in_progress" | "todo";

export type SeedSubtask = { title: string; done: boolean };

export type SeedTask = {
  team: string;
  title: string;
  status: SeedStatus;
  phase?: string | null;
  description?: string;
  dueDate?: string;
  dueTime?: string;
  trackingCode?: string;
  subtasks?: SeedSubtask[];
};

export type SeedCase = {
  name: string;
  role: string;
  department: string;
  deadline: string;
  tasks: readonly SeedTask[];
};

export const baseSeedCases: readonly SeedCase[] = [
  {
    name: "Marina Lopes",
    role: "Analista de marketing",
    department: "Marketing",
    deadline: "2026-11-13",
    tasks: [
      { team: "RH e DP", title: "Conferir estabilidades", status: "done", phase: "pre" },
      {
        team: "RH e DP",
        title: "Comunicar desligamento e aviso prévio",
        status: "done",
        phase: "pre",
        description: "Agendar reunião com o gestor e comunicar formalmente o desligamento.",
      },
      { team: "RH e DP", title: "Enviar convite do app Offboard", status: "done", phase: "d0" },
      {
        team: "RH e DP",
        title: "Avisar sobre a continuidade do plano de saúde",
        status: "done",
        phase: "first-week",
      },
      {
        team: "RH e DP",
        title: "Fechar ponto e banco de horas",
        status: "done",
        phase: "d0",
        description: "Exportar relatório do sistema de ponto e validar saldo de banco de horas.",
      },
      {
        team: "RH e DP",
        title: "Agendar exame demissional",
        status: "done",
        phase: "pre",
        dueDate: "2026-11-10",
      },
      {
        team: "RH e DP",
        title: "Calcular a rescisão",
        status: "in_progress",
        phase: "first-week",
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
        phase: "first-week",
        dueDate: "2026-11-13",
      },
      {
        team: "RH e DP",
        title: "Recolher FGTS e multa rescisória",
        status: "todo",
        phase: "first-week",
      },
      {
        team: "RH e DP",
        title: "Pagar a rescisão e enviar os documentos",
        status: "todo",
        phase: "first-week",
        dueDate: "2026-11-13",
      },
      { team: "RH e DP", title: "Encerrar os vales", status: "todo", phase: "second-week" },
      {
        team: "TI",
        title: "Bloquear acessos no último dia",
        status: "done",
        phase: "d0",
        description: "Desativar conta no Google Workspace, Slack, VPN e demais ferramentas.",
        subtasks: [
          { title: "Google Workspace", done: true },
          { title: "Slack", done: true },
          { title: "VPN", done: true },
          { title: "GitHub", done: true },
        ],
      },
      { team: "TI", title: "Transferir arquivos e e-mail", status: "done", phase: "first-week" },
      { team: "TI", title: "Cancelar licenças", status: "done", phase: "first-week" },
      {
        team: "TI",
        title: "Coletar notebook e acessórios",
        status: "in_progress",
        phase: "first-week",
        description: "Agendar logística reversa com a transportadora.",
        trackingCode: "BR123456789BR",
      },
      {
        team: "TI",
        title: "Apagar dados e devolver ao estoque",
        status: "todo",
        phase: "second-week",
      },
      {
        team: "Gestão",
        title: "Montar o mapa de passagem de trabalho",
        status: "done",
        phase: "pre",
      },
      {
        team: "Gestão",
        title: "Confirmar a passagem com Marina",
        status: "in_progress",
        phase: "first-week",
      },
      { team: "Gestão", title: "Trocar o responsável no CRM", status: "done", phase: "first-week" },
      {
        team: "Gestão",
        title: "Avisar clientes e fornecedores",
        status: "done",
        phase: "first-week",
      },
      {
        team: "Financeiro",
        title: "Aprovar reembolsos pendentes",
        status: "in_progress",
        phase: "second-week",
      },
      {
        team: "Jurídico",
        title: "Verificar procurações e certificados",
        status: "done",
        phase: "second-week",
      },
      {
        team: "Jurídico",
        title: "Transferir contas externas",
        status: "todo",
        phase: "first-week",
      },
      { team: "Facilities", title: "Desativar crachá e acesso", status: "done", phase: "d0" },
      {
        team: "Pessoa desligada",
        title: "Confirmar itens e agendar a coleta",
        status: "done",
        phase: "first-week",
        dueDate: "2026-11-13",
        dueTime: "15:00",
      },
      {
        team: "Pessoa desligada",
        title: "Fazer o exame demissional",
        status: "todo",
        phase: "first-week",
        dueDate: "2026-11-13",
        dueTime: "09:30",
      },
      {
        team: "Pessoa desligada",
        title: "Responder à pesquisa de desligamento",
        status: "todo",
        phase: "follow-up",
      },
    ],
  },
  {
    name: "Rafael Mendes",
    role: "Engenheiro de software",
    department: "Tecnologia",
    deadline: "2026-11-16",
    tasks: [
      {
        team: "RH e DP",
        title: "Comunicar desligamento e aviso prévio",
        status: "done",
        phase: "pre",
      },
      { team: "RH e DP", title: "Agendar exame demissional", status: "done", phase: "pre" },
      {
        team: "RH e DP",
        title: "Enviar o termo de rescisão",
        status: "todo",
        phase: "first-week",
        dueDate: "2026-11-16",
      },
      {
        team: "TI",
        title: "Transferir repositórios e acessos",
        status: "in_progress",
        phase: "first-week",
        description: "Transferir ownership dos repositórios e revogar tokens de acesso.",
        subtasks: [
          { title: "Transferir repos do GitHub", done: true },
          { title: "Revogar tokens e SSH keys", done: false },
          { title: "Transferir pipelines de CI/CD", done: false },
        ],
      },
      {
        team: "TI",
        title: "Recolher equipamentos",
        status: "todo",
        phase: "first-week",
        trackingCode: "BR987654321BR",
      },
      { team: "Gestão", title: "Confirmar a passagem de trabalho", status: "done", phase: "pre" },
    ],
  },
  {
    name: "Bianca Souza",
    role: "Coordenadora de operações",
    department: "Operações",
    deadline: "2026-11-18",
    tasks: [
      {
        team: "RH e DP",
        title: "Comunicar desligamento e aviso prévio",
        status: "done",
        phase: "pre",
      },
      {
        team: "RH e DP",
        title: "Fechar ponto e banco de horas",
        status: "in_progress",
        phase: "d0",
      },
      {
        team: "RH e DP",
        title: "Enviar o termo de rescisão",
        status: "todo",
        phase: "first-week",
        dueDate: "2026-11-18",
      },
      {
        team: "TI",
        title: "Recolher equipamentos",
        status: "todo",
        phase: "first-week",
        trackingCode: "BR456789012BR",
      },
      {
        team: "Gestão",
        title: "Repasse das rotinas de operação",
        status: "done",
        phase: "first-week",
      },
    ],
  },
  {
    name: "André Lima",
    role: "Analista financeiro",
    department: "Financeiro",
    deadline: "2026-11-19",
    tasks: [
      {
        team: "RH e DP",
        title: "Comunicar desligamento e aviso prévio",
        status: "done",
        phase: "pre",
      },
      {
        team: "RH e DP",
        title: "Agendar exame demissional",
        status: "todo",
        phase: "pre",
        dueDate: "2026-11-15",
      },
      {
        team: "Financeiro",
        title: "Transferir aprovações de pagamentos",
        status: "in_progress",
        phase: "first-week",
      },
      { team: "TI", title: "Desativar acessos", status: "todo", phase: "d0" },
    ],
  },
  {
    name: "Nina Castro",
    role: "Designer de produto",
    department: "Produto",
    deadline: "2026-11-23",
    tasks: [
      {
        team: "RH e DP",
        title: "Comunicar desligamento e aviso prévio",
        status: "done",
        phase: "pre",
      },
      {
        team: "RH e DP",
        title: "Agendar exame demissional",
        status: "todo",
        phase: "pre",
        dueDate: "2026-11-20",
      },
      { team: "TI", title: "Transferir acesso aos projetos", status: "todo", phase: "first-week" },
      {
        team: "Gestão",
        title: "Confirmar a passagem de trabalho",
        status: "in_progress",
        phase: "pre",
      },
      { team: "Facilities", title: "Devolver chaves do armário", status: "todo" },
    ],
  },
];

export const seedCases: readonly SeedCase[] = [
  ...baseSeedCases,
  {
    name: "Gustavo Ribeiro",
    role: "Gerente de vendas",
    department: "Comercial",
    deadline: "2026-12-05",
    tasks: [
      {
        team: "RH e DP",
        title: "Conferir estabilidades",
        status: "in_progress",
        phase: "pre",
        description: "Verificar se há estabilidade provisória (CIPA, gestante, acidentário).",
      },
      {
        team: "RH e DP",
        title: "Comunicar desligamento e aviso prévio",
        status: "todo",
        phase: "pre",
      },
      {
        team: "RH e DP",
        title: "Agendar exame demissional",
        status: "todo",
        phase: "pre",
        dueDate: "2026-12-01",
      },
      {
        team: "RH e DP",
        title: "Enviar convite do app Offboard",
        status: "todo",
        phase: "d0",
      },
      {
        team: "RH e DP",
        title: "Fechar ponto e banco de horas",
        status: "todo",
        phase: "d0",
      },
      {
        team: "RH e DP",
        title: "Calcular a rescisão",
        status: "todo",
        phase: "first-week",
        dueDate: "2026-12-05",
      },
      {
        team: "Gestão",
        title: "Montar o mapa de passagem de trabalho",
        status: "todo",
        phase: "pre",
      },
      {
        team: "Gestão",
        title: "Redistribuir a carteira de clientes",
        status: "todo",
        phase: "first-week",
      },
      {
        team: "TI",
        title: "Bloquear acessos no último dia",
        status: "todo",
        phase: "d0",
      },
      {
        team: "TI",
        title: "Coletar notebook e acessórios",
        status: "todo",
        phase: "first-week",
      },
      {
        team: "Financeiro",
        title: "Cancelar cartão corporativo",
        status: "todo",
        phase: "d0",
      },
    ],
  },
  {
    name: "Carla Mendonça",
    role: "Analista de suporte",
    department: "Tecnologia",
    deadline: "2026-12-10",
    tasks: [
      {
        team: "RH e DP",
        title: "Conferir estabilidades",
        status: "todo",
        phase: "pre",
      },
      {
        team: "RH e DP",
        title: "Comunicar desligamento e aviso prévio",
        status: "todo",
        phase: "pre",
      },
      {
        team: "RH e DP",
        title: "Agendar exame demissional",
        status: "todo",
        phase: "pre",
        dueDate: "2026-12-06",
      },
      {
        team: "TI",
        title: "Bloquear acessos no último dia",
        status: "todo",
        phase: "d0",
      },
      {
        team: "TI",
        title: "Transferir tickets e base de conhecimento",
        status: "todo",
        phase: "first-week",
      },
      {
        team: "Gestão",
        title: "Redistribuir escala de plantão",
        status: "todo",
        phase: "pre",
      },
    ],
  },
  {
    name: "Felipe Oliveira",
    role: "Coordenador de logística",
    department: "Operações",
    deadline: "2026-11-05",
    tasks: [
      {
        team: "RH e DP",
        title: "Comunicar desligamento e aviso prévio",
        status: "done",
        phase: "pre",
      },
      { team: "RH e DP", title: "Agendar exame demissional", status: "done", phase: "pre" },
      { team: "RH e DP", title: "Fechar ponto e banco de horas", status: "done", phase: "d0" },
      { team: "RH e DP", title: "Calcular a rescisão", status: "done", phase: "first-week" },
      {
        team: "RH e DP",
        title: "Enviar desligamento ao eSocial",
        status: "done",
        phase: "first-week",
      },
      {
        team: "RH e DP",
        title: "Pagar a rescisão e enviar os documentos",
        status: "done",
        phase: "first-week",
      },
      { team: "TI", title: "Bloquear acessos no último dia", status: "done", phase: "d0" },
      { team: "TI", title: "Coletar notebook e acessórios", status: "done", phase: "first-week" },
      {
        team: "Gestão",
        title: "Confirmar a passagem de trabalho",
        status: "done",
        phase: "pre",
      },
      {
        team: "Gestão",
        title: "Transferir negócios e contatos no CRM",
        status: "done",
        phase: "first-week",
      },
      {
        team: "Pessoa desligada",
        title: "Responder à pesquisa de desligamento",
        status: "done",
        phase: "follow-up",
      },
    ],
  },
  {
    name: "Helena Pires",
    role: "Analista financeira",
    department: "Financeiro",
    deadline: "2026-12-12",
    tasks: [
      {
        team: "RH e DP",
        title: "Comunicar desligamento e aviso prévio",
        status: "done",
        phase: "pre",
      },
      { team: "RH e DP", title: "Agendar exame demissional", status: "todo", phase: "pre" },
      { team: "TI", title: "Bloquear acessos no último dia", status: "todo", phase: "d0" },
    ],
  },
  {
    name: "Diego Rocha",
    role: "Desenvolvedor",
    department: "Tecnologia",
    deadline: "2026-12-19",
    tasks: [
      {
        team: "RH e DP",
        title: "Comunicar desligamento e aviso prévio",
        status: "in_progress",
        phase: "pre",
      },
      { team: "TI", title: "Coletar notebook e acessórios", status: "todo", phase: "first-week" },
    ],
  },
];
