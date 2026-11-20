import {
  beneficiaries,
  checklistRules,
  equipment,
  integrations,
  offboardingCases,
  plans,
  tasks,
  teamMembers,
} from "./schema/index.ts";
import type { Db } from "./repositories/tasks.ts";

type TaskSeed = [team: string, title: string, status: "done" | "in_progress" | "todo"];

const caseSeeds: {
  name: string;
  role: string;
  department: string;
  deadline: string;
  tasks: TaskSeed[];
}[] = [
  {
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
      ["RH e DP", "Calcular a rescisão", "in_progress"],
      ["RH e DP", "Enviar desligamento ao eSocial", "todo"],
      ["RH e DP", "Recolher FGTS e multa rescisória", "todo"],
      ["RH e DP", "Pagar a rescisão e enviar os documentos", "todo"],
      ["RH e DP", "Encerrar os vales", "todo"],
      ["TI", "Bloquear acessos no último dia", "done"],
      ["TI", "Transferir arquivos e e-mail", "done"],
      ["TI", "Cancelar licenças", "done"],
      ["TI", "Coletar notebook e acessórios", "in_progress"],
      ["TI", "Apagar dados e devolver ao estoque", "todo"],
      ["Gestão", "Montar o mapa de passagem de trabalho", "done"],
      ["Gestão", "Confirmar a passagem com Marina", "in_progress"],
      ["Gestão", "Trocar o responsável no CRM", "done"],
      ["Gestão", "Avisar clientes e fornecedores", "done"],
      ["Financeiro", "Aprovar reembolsos pendentes", "in_progress"],
      ["Jurídico", "Verificar procurações e certificados", "done"],
      ["Jurídico", "Transferir contas externas", "todo"],
      ["Facilities", "Desativar crachá e acesso", "done"],
      ["Pessoa desligada", "Confirmar itens e agendar a coleta", "done"],
      ["Pessoa desligada", "Fazer o exame demissional", "todo"],
      ["Pessoa desligada", "Responder à pesquisa de desligamento", "todo"],
    ],
  },
  {
    name: "Rafael Mendes",
    role: "Engenheiro de software",
    department: "Tecnologia",
    deadline: "2026-11-16",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done"],
      ["RH e DP", "Agendar exame demissional", "done"],
      ["RH e DP", "Enviar o termo de rescisão", "todo"],
      ["TI", "Transferir repositórios e acessos", "in_progress"],
      ["TI", "Recolher equipamentos", "todo"],
      ["Gestão", "Confirmar a passagem de trabalho", "done"],
    ],
  },
  {
    name: "Bianca Souza",
    role: "Coordenadora de operações",
    department: "Operações",
    deadline: "2026-11-18",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done"],
      ["RH e DP", "Fechar ponto e banco de horas", "in_progress"],
      ["RH e DP", "Enviar o termo de rescisão", "todo"],
      ["TI", "Recolher equipamentos", "todo"],
      ["Gestão", "Repasse das rotinas de operação", "done"],
    ],
  },
  {
    name: "André Lima",
    role: "Analista financeiro",
    department: "Financeiro",
    deadline: "2026-11-19",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done"],
      ["RH e DP", "Agendar exame demissional", "todo"],
      ["Financeiro", "Transferir aprovações de pagamentos", "in_progress"],
      ["TI", "Desativar acessos", "todo"],
    ],
  },
  {
    name: "Nina Castro",
    role: "Designer de produto",
    department: "Produto",
    deadline: "2026-11-23",
    tasks: [
      ["RH e DP", "Comunicar desligamento e aviso prévio", "done"],
      ["RH e DP", "Agendar exame demissional", "todo"],
      ["TI", "Transferir acesso aos projetos", "todo"],
      ["Gestão", "Confirmar a passagem de trabalho", "in_progress"],
    ],
  },
];

const equipmentSeeds: (typeof equipment.$inferInsert)[] = [
  {
    item: "Notebook Dell Latitude 5440",
    tag: "AUR-0412",
    person: "Marina Lopes",
    method: "Coleta em casa",
    scheduledDate: "2026-11-10",
    status: "scheduled",
  },
  {
    item: "Notebook MacBook Air M3",
    tag: "AUR-0398",
    person: "Léo Andrade",
    method: "Coleta em casa",
    scheduledDate: null,
    status: "received",
  },
  {
    item: "Notebook Dell Latitude 5440",
    tag: "AUR-0377",
    person: "Rafa Souza",
    method: "Coleta em casa",
    scheduledDate: "2026-11-09",
    status: "failed",
  },
  {
    item: "Celular Galaxy A55",
    tag: "AUR-2210",
    person: "Otávio Lima",
    method: "Entrega no escritório",
    scheduledDate: null,
    status: "inventory",
  },
  {
    item: "Notebook ThinkPad T14",
    tag: "AUR-0455",
    person: "Igor Santos",
    method: "Coleta em casa",
    scheduledDate: null,
    status: "transit",
  },
  {
    item: "Monitor Dell 27″",
    tag: "AUR-3104",
    person: "Igor Santos",
    method: "Coleta em casa",
    scheduledDate: null,
    status: "transit",
  },
  {
    item: "Notebook MacBook Pro 14",
    tag: "AUR-0301",
    person: "Sofia Ramos",
    method: "Coleta em casa",
    scheduledDate: "2026-11-12",
    status: "with_person",
  },
  {
    item: "Kit EPI e rádio",
    tag: "AUR-5520",
    person: "Marcos Vieira",
    method: "Entrega no escritório",
    scheduledDate: null,
    status: "received",
  },
  {
    item: "Notebook Dell Latitude 5440",
    tag: "AUR-0419",
    person: "Ju Martins",
    method: "Coleta em casa",
    scheduledDate: "2026-11-11",
    status: "scheduled",
  },
];

const integrationSeeds: (typeof integrations.$inferInsert)[] = [
  {
    name: "Sistema de folha",
    purpose: "Envia cadastro, rescisão, eSocial e FGTS.",
    status: "connected",
    lastActivity: "8 nov, 7h30 · 23 cadastros atualizados",
  },
  {
    name: "Sistema de ponto",
    purpose: "Fecha ponto e banco de horas.",
    status: "connected",
    lastActivity: "4 nov · 23 fechamentos",
  },
  {
    name: "Google Workspace",
    purpose: "Bloqueia acessos e transfere arquivos.",
    status: "connected",
    lastActivity: "3 nov · 21 contas atualizadas",
  },
  {
    name: "Slack",
    purpose: "Bloqueia acessos e avisa as áreas responsáveis.",
    status: "connected",
    lastActivity: "8 nov, 8h02 · 14 avisos",
  },
  {
    name: "HubSpot",
    purpose: "Transfere negócios e contatos.",
    status: "connected",
    lastActivity: "4 nov · 61 negócios transferidos",
  },
  {
    name: "Inventário de TI",
    purpose: "Lista os bens de cada pessoa e registra a entrada no estoque.",
    status: "connected",
    lastActivity: "8 nov, 9h40 · 2 itens conferidos",
  },
  {
    name: "Transportadora",
    purpose: "Agenda e rastreia a coleta em casa.",
    status: "connected",
    lastActivity: "8 nov, 9h12 · Coleta confirmada",
  },
  {
    name: "Clínica ocupacional",
    purpose: "Agenda o exame demissional.",
    status: "connected",
    lastActivity: "4 nov · 23 agendamentos",
  },
  {
    name: "Operadora do plano de saúde",
    purpose: "Informa o direito de manter o plano.",
    status: "connected",
    lastActivity: "3 nov · 23 avisos",
  },
  {
    name: "Cartão corporativo",
    purpose: "Cancela cartões e lista despesas em aberto.",
    status: "disconnected",
    lastActivity: null,
  },
  {
    name: "Microsoft 365",
    purpose: "Bloqueia acessos e transfere arquivos de trabalho.",
    status: "disconnected",
    lastActivity: null,
  },
];

const beneficiarySeeds: (typeof beneficiaries.$inferInsert)[] = [
  { name: "Marina Lopes", plan: "Gold", status: "Ativo", accessUntil: "30 abr" },
  { name: "Lucas Almeida", plan: "Silver", status: "Convidado", accessUntil: "Após ativação" },
  { name: "Renata Souza", plan: "Platinum", status: "Ativo", accessUntil: "22 abr" },
  { name: "Pedro Santos", plan: "Gold", status: "Ativo", accessUntil: "31 mar" },
  { name: "Carla Mendes", plan: "Silver", status: "Expirado", accessUntil: "31 out" },
];

const teamMemberSeeds: (typeof teamMembers.$inferInsert)[] = [
  {
    name: "Beatriz Castro",
    role: "Admin",
    accessScope: "Áreas administrativas",
    securityStatus: "2FA ativo",
  },
  {
    name: "Camila Rocha",
    role: "Analista",
    accessScope: "Cadastro e painel",
    securityStatus: "2FA ativo",
  },
  {
    name: "Diego Alves",
    role: "Financeiro",
    accessScope: "Gastos e faturas",
    securityStatus: "Convite pendente",
  },
];

const planSeeds = [
  { name: "Silver", price: 149, active: 12, capacity: 20, area: "Tecnologia" },
  { name: "Gold", price: 249, active: 20, capacity: 30, area: "Marketing" },
  { name: "Platinum", price: 399, active: 12, capacity: 15, area: "Operações" },
  { name: "Platinum Premium", price: 699, active: 4, capacity: 5, area: "Liderança" },
];

const checklistRuleSeeds: (typeof checklistRules.$inferInsert)[] = [
  {
    title: "Aplicar o modelo base da CLT",
    description: "Aviso prévio, exame demissional, rescisão, eSocial, FGTS e benefícios.",
    team: "RH e DP",
    timing: "A partir do dia 0",
    required: true,
  },
  {
    title: "Agendar coleta em casa",
    description: "A pessoa escolhe o horário pelo app quando trabalha remotamente.",
    team: "TI",
    timing: "Dias 1 a 7",
  },
  {
    title: "Conferir o inventário de TI",
    description: "Registrar os bens e acompanhar a devolução ao estoque.",
    team: "TI",
    timing: "Dias 1 a 7",
  },
  {
    title: "Transferir negócios e contatos",
    description: "Passar os registros no CRM para quem a gestão indicar.",
    team: "Gestão",
    timing: "Dias 1 a 7",
  },
  {
    title: "Encerrar acesso ao Google Workspace",
    description: "Bloquear o acesso e transferir os arquivos.",
    team: "TI",
    timing: "Dia 0",
  },
  {
    title: "Conciliar despesas e cancelar o cartão",
    description: "Aplicável a quem tem cartão corporativo.",
    team: "Financeiro",
    timing: "Dias 1 a 7",
  },
  {
    title: "Revisar procurações e certificados",
    description: "Verificar quais autorizações precisam ser revogadas.",
    team: "Jurídico",
    timing: "Antes da comunicação",
  },
  {
    title: "Revisar estabilidade",
    description: "Encaminhar casos sinalizados para análise do Jurídico.",
    team: "Jurídico",
    timing: "Antes da comunicação",
  },
  {
    title: "Analisar desligamentos coletivos",
    description: "Acionar o Jurídico quando o volume exigir avaliação.",
    team: "Jurídico",
    timing: "Antes da comunicação",
  },
];

export async function seed(db: Db) {
  await db.transaction(async (tx) => {
    await tx.delete(tasks);
    await tx.delete(offboardingCases);
    await tx.delete(equipment);
    await tx.delete(integrations);
    await tx.delete(beneficiaries);
    await tx.delete(teamMembers);
    await tx.delete(plans);
    await tx.delete(checklistRules);

    for (const { tasks: taskSeeds, ...caseSeed } of caseSeeds) {
      const [created] = await tx.insert(offboardingCases).values(caseSeed).returning();
      await tx.insert(tasks).values(
        taskSeeds.map(([team, title, status]) => ({
          caseId: created!.id,
          team,
          title,
          status,
        })),
      );
    }

    await tx.insert(equipment).values(equipmentSeeds);
    await tx.insert(integrations).values(integrationSeeds);
    await tx.insert(beneficiaries).values(beneficiarySeeds);
    await tx.insert(teamMembers).values(teamMemberSeeds);
    await tx.insert(plans).values(
      planSeeds.map(({ name, price, active, capacity, area }) => ({
        name,
        priceCents: price * 100,
        activeLicenses: active,
        capacity,
        costCenter: area,
      })),
    );
    await tx.insert(checklistRules).values(checklistRuleSeeds);
  });
}
