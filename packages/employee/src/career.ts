import { z } from "zod";

export const demoName = "Marina Lopes";

const resumeFields = z.object({
  name: z.string().trim().max(1200),
  headline: z.string().trim().max(1200),
  summary: z.string().trim().max(1200),
  launchResult: z.string().trim().max(1200),
  campaignResult: z.string().trim().max(1200),
  skills: z.string().trim().max(1200),
});

export const resumeFormSchema = resumeFields.extend({
  name: resumeFields.shape.name.min(2, "Informe seu nome."),
  headline: resumeFields.shape.headline.min(3, "Informe seu título profissional."),
  summary: resumeFields.shape.summary.min(15, "Escreva pelo menos 15 caracteres."),
  launchResult: resumeFields.shape.launchResult.min(3, "Descreva sua experiência com lançamentos."),
  campaignResult: resumeFields.shape.campaignResult.min(
    3,
    "Descreva sua experiência com campanhas.",
  ),
  skills: resumeFields.shape.skills.min(3, "Informe pelo menos uma competência."),
});

export const versionLabelSchema = z.string().trim().min(3, "Dê um nome à versão.");

export type Resume = z.infer<typeof resumeFields>;

const interviewSchema = z.object({
  date: z.iso.date(),
  time: z.string(),
  title: z.string(),
  format: z.string(),
  instructions: z.string(),
});

const applicationStatus = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sent") }),
  z.object({ kind: z.literal("review") }),
  z.object({ kind: z.literal("reply") }),
  z.object({ kind: z.literal("interview"), interview: interviewSchema }),
  z.object({ kind: z.literal("offer") }),
]);

export const versionSchema = z.object({
  id: z.string(),
  label: versionLabelSchema,
  company: z.string(),
  match: z.number().min(0).max(100).nullable(),
  resume: resumeFields,
  updatedAt: z.iso.date(),
});

export type ResumeVersion = z.infer<typeof versionSchema>;

const applicationSchema = z.object({
  id: z.string(),
  jobId: z.string().nullable(),
  versionId: z.string().nullable(),
  title: z.string(),
  company: z.string(),
  color: z.string(),
  appliedAt: z.iso.date(),
  status: applicationStatus,
});

export type Application = z.infer<typeof applicationSchema>;

export type Interview = z.infer<typeof interviewSchema>;

export const careerSchema = z.object({
  base: resumeFields,
  baseUpdatedAt: z.iso.date(),
  versions: z.array(versionSchema).max(100),
  applications: z.array(applicationSchema).max(200),
  published: z.boolean(),
});

export type CareerData = z.infer<typeof careerSchema>;

const initialResume: Resume = {
  name: "",
  headline: "Analista de Marketing Pleno",
  summary:
    "Planejo campanhas digitais e acompanho indicadores para melhorar a aquisição e o relacionamento com clientes.",
  launchResult: "Participei do lançamento da linha Verão com o time de produto.",
  campaignResult: "Planejei campanhas de CRM e acompanhei o desempenho por canal.",
  skills:
    "Marketing digital, CRM, Excel, Planejamento de campanhas, Testes A/B, Análise de métricas",
};

export const initialCareer = careerSchema.parse({
  base: initialResume,
  baseUpdatedAt: "2026-11-21",
  published: true,
  versions: [
    {
      id: "version-lumen",
      label: "Analista de Marketing Pleno",
      company: "Lumen Cosméticos",
      match: 92,
      resume: initialResume,
      updatedAt: "2026-11-14",
    },
    {
      id: "version-trilha",
      label: "Marketing de Produto",
      company: "Trilha Seguros",
      match: 88,
      resume: { ...initialResume, headline: "Analista de Marketing de Produto" },
      updatedAt: "2026-11-20",
    },
    {
      id: "version-casa",
      label: "Analista de CRM",
      company: "Casa Viva",
      match: 85,
      resume: { ...initialResume, headline: "Analista de CRM" },
      updatedAt: "2026-11-21",
    },
  ],
  applications: [
    {
      id: "lumen",
      jobId: null,
      versionId: "version-lumen",
      title: "Analista de Marketing Pleno",
      company: "Lumen Cosméticos",
      color: "#B81758",
      appliedAt: "2026-11-14",
      status: {
        kind: "interview",
        interview: {
          date: "2026-11-26",
          time: "10h",
          title: "Entrevista com o RH da Lumen Cosméticos",
          format: "Videochamada",
          instructions:
            "Conversa inicial sobre a vaga e sua trajetória. O RH ficou de enviar o convite por e-mail.",
        },
      },
    },
    {
      id: "ponte",
      jobId: null,
      versionId: null,
      title: "Analista de Aquisição",
      company: "Ponte Pagamentos",
      color: "#99351B",
      appliedAt: "2026-11-17",
      status: {
        kind: "interview",
        interview: {
          date: "2026-11-27",
          time: "14h30",
          title: "Entrevista com o time de Aquisição",
          format: "Videochamada",
          instructions:
            "Conversa com a liderança da área. Leve um exemplo de campanha e os resultados que você acompanhou.",
        },
      },
    },
    {
      id: "casa",
      jobId: null,
      versionId: null,
      title: "Analista de CRM Júnior",
      company: "Casa Viva",
      color: "#214CCB",
      appliedAt: "2026-11-18",
      status: { kind: "reply" },
    },
    {
      id: "trilha",
      jobId: null,
      versionId: "version-trilha",
      title: "Marketing de Produto",
      company: "Trilha Seguros",
      color: "#13746C",
      appliedAt: "2026-11-20",
      status: { kind: "review" },
    },
    {
      id: "serra",
      jobId: null,
      versionId: null,
      title: "Analista de Comunicação",
      company: "Serra Digital",
      color: "#285497",
      appliedAt: "2026-11-22",
      status: { kind: "sent" },
    },
    {
      id: "rota",
      jobId: null,
      versionId: null,
      title: "Analista de CRM",
      company: "Rota Logística",
      color: "#5A3D94",
      appliedAt: "2026-11-19",
      status: { kind: "review" },
    },
    {
      id: "viva",
      jobId: null,
      versionId: null,
      title: "Analista de Conteúdo",
      company: "Viva Educação",
      color: "#795529",
      appliedAt: "2026-11-16",
      status: { kind: "sent" },
    },
  ],
} satisfies CareerData);

export const jobSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  location: z.string().max(200),
  mode: z.enum(["hybrid", "remote"]),
  salary: z.string().max(100),
  source: z.enum(["board", "cohort", "recruiter"]),
  description: z.string().max(1200),
  requirements: z.array(z.tuple([z.string().max(120), z.number().min(0).max(100)])).max(20),
});

export type Job = Omit<z.infer<typeof jobSchema>, "requirements"> & {
  requirements: ReadonlyArray<readonly [skill: string, weight: number]>;
};

type JobSource = Job["source"];

export function emptyCareer(name: string, date: string) {
  return {
    base: { name, headline: "", summary: "", launchResult: "", campaignResult: "", skills: "" },
    baseUpdatedAt: date,
    versions: [],
    applications: [],
    published: false,
  } satisfies CareerData;
}

export const jobs: readonly Job[] = [
  {
    id: "mercado-marketing",
    title: "Analista de Marketing Pleno",
    company: "Mercado Fino",
    color: "#13746C",
    location: "São Paulo",
    mode: "hybrid",
    salary: "R$ 7.500 a 9.000",
    source: "board",
    description:
      "Planeje campanhas de aquisição e acompanhe os resultados por canal com o time de e-commerce.",
    requirements: [
      ["Marketing digital", 34],
      ["Planejamento de campanhas", 32],
      ["Análise de métricas", 28],
      ["Google Analytics 4", 6],
    ],
  },
  {
    id: "ponte-growth",
    title: "Analista de Growth",
    company: "Ponte Pagamentos",
    color: "#99351B",
    location: "",
    mode: "remote",
    salary: "R$ 8.000 a 10.000",
    source: "cohort",
    description: "Crie experimentos de aquisição e retenção, da hipótese à análise dos resultados.",
    requirements: [
      ["Testes A/B", 32],
      ["Análise de métricas", 30],
      ["CRM", 27],
      ["SQL", 11],
    ],
  },
  {
    id: "casa-digital",
    title: "Analista de Marketing Digital",
    company: "Casa Viva",
    color: "#214CCB",
    location: "Campinas",
    mode: "hybrid",
    salary: "Faixa não informada",
    source: "recruiter",
    description:
      "Cuide do calendário de campanhas digitais e acompanhe o desempenho dos canais de mídia.",
    requirements: [
      ["Marketing digital", 34],
      ["Planejamento de campanhas", 28],
      ["Excel", 24],
      ["Google Analytics 4", 14],
    ],
  },
  {
    id: "nuvem-produto",
    title: "Analista de Marketing de Produto",
    company: "Nuvem Alta Software",
    color: "#6527C5",
    location: "",
    mode: "remote",
    salary: "R$ 7.000 a 8.500",
    source: "board",
    description:
      "Organize lançamentos de produto, planeje a comunicação e acompanhe a adoção pelos clientes.",
    requirements: [
      ["Planejamento de campanhas", 33],
      ["CRM", 28],
      ["Análise de métricas", 24],
      ["Posicionamento de produto", 15],
    ],
  },
];

export const sourceLabels = {
  board: "Portal de vagas",
  cohort: "Compartilhada pela turma",
  recruiter: "Indicada por uma recrutadora parceira",
} satisfies Record<JobSource, string>;

const statusLabels = {
  sent: "Enviada",
  review: "Em análise",
  reply: "Retorno",
  interview: "Entrevista",
  offer: "Oferta",
} satisfies Record<Application["status"]["kind"], string>;

export function applicationStatusLabel({ jobId, status }: Application) {
  return jobId && status.kind === "sent" ? "Registrada" : statusLabels[status.kind];
}

export const statusFilters = [
  { id: "all", label: "registradas" },
  { id: "replied", label: "responderam" },
  { id: "interviews", label: "entrevistas" },
  { id: "offers", label: "ofertas" },
] as const;

export type StatusFilter = (typeof statusFilters)[number]["id"];

export function matchesStatus(application: Application, filter: StatusFilter) {
  switch (filter) {
    case "all":
      return true;
    case "replied":
      return ["interview", "reply", "offer"].includes(application.status.kind);
    case "interviews":
      return application.status.kind === "interview";
    case "offers":
      return application.status.kind === "offer";
  }
}

export function applicationCounts(applications: Application[]) {
  return {
    all: applications.length,
    replied: applications.filter((application) => matchesStatus(application, "replied")).length,
    interviews: applications.filter((application) => matchesStatus(application, "interviews"))
      .length,
    offers: applications.filter((application) => matchesStatus(application, "offers")).length,
  };
}

export function skillsList(skills: string) {
  return [
    ...new Set(
      skills
        .split(/[,\n]+/)
        .map((skill) => skill.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizedSkill(skill: string) {
  return skill
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function jobFit(job: Job, resume: Resume) {
  const skills = new Set(skillsList(resume.skills).map(normalizedSkill));
  const matches = job.requirements.filter(([skill]) => skills.has(normalizedSkill(skill)));

  const total = job.requirements.reduce((sum, [, points]) => sum + points, 0);

  return {
    score: total
      ? Math.round((100 * matches.reduce((sum, [, points]) => sum + points, 0)) / total)
      : 0,
    skills: matches.map(([skill]) => skill),
  };
}

function adaptResume(job: Job, resume: Resume) {
  const fit = jobFit(job, resume);

  return {
    ...resume,
    skills: skillsList([...fit.skills, ...skillsList(resume.skills)].join(", ")).join(", "),
  } satisfies Resume;
}

export function applyForJob(
  data: CareerData,
  { job, date, name }: { job: Job; date: string; name: string },
) {
  if (data.applications.some((application) => application.jobId === job.id)) return data;

  const version: ResumeVersion = {
    id: `job-${job.id}`,
    label: job.title,
    company: job.company,
    match: jobFit(job, data.base).score,
    resume: adaptResume(job, { ...data.base, name: data.base.name || name }),
    updatedAt: date,
  };

  const application: Application = {
    id: job.id,
    jobId: job.id,
    versionId: version.id,
    title: job.title,
    company: job.company,
    color: job.color,
    appliedAt: date,
    status: { kind: "sent" },
  };

  return {
    ...data,
    versions: [version, ...data.versions],
    applications: [application, ...data.applications],
  } satisfies CareerData;
}

export const suggestions = [
  {
    field: "launchResult",
    text: "Inclua o resultado do lançamento da linha Verão, como vendas ou conversão.",
    points: 4,
    resolved: (resume: Resume) => /\d/.test(resume.launchResult),
  },
  {
    field: "campaignResult",
    text: "Acrescente um resultado mensurável das campanhas que você planejou.",
    points: 4,
    resolved: (resume: Resume) => /\d/.test(resume.campaignResult),
  },
  {
    field: "skills",
    text: "Inclua Google Analytics 4 ou SQL se você usa essas ferramentas.",
    points: 3,
    resolved: (resume: Resume) =>
      skillsList(resume.skills).some((skill) =>
        ["google analytics 4", "sql"].includes(normalizedSkill(skill)),
      ),
  },
] as const;

export type Suggestion = (typeof suggestions)[number];

export function resumeScore(resume: Resume) {
  return suggestions.reduce(
    (score, suggestion) => score + (suggestion.resolved(resume) ? suggestion.points : 0),
    82,
  );
}

export function localDate() {
  const today = new Date();
  const year = String(today.getFullYear());
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" });

const calendarDayFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function displayDate(date: string) {
  return dateFormat.format(parseDate(date));
}

export function displayCalendarDay(date: string) {
  const day = parseDate(date);

  return day.getUTCFullYear() === new Date().getFullYear()
    ? calendarDayFormat.format(day)
    : dateFormat.format(day);
}

function parseDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

export function shiftDate(date: string, days: number) {
  const parsed = parseDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);

  return parsed.toISOString().slice(0, 10);
}

export function weekStart(date: string) {
  return shiftDate(date, -((parseDate(date).getUTCDay() + 6) % 7));
}

const monthFormat = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });

export function weekRange(startDate: string) {
  const start = parseDate(startDate);
  const end = parseDate(shiftDate(startDate, 6));
  const endMonth = monthFormat.format(end);

  if (start.getUTCMonth() === end.getUTCMonth())
    return `${start.getUTCDate()} a ${end.getUTCDate()} de ${endMonth}`;

  return `${start.getUTCDate()} de ${monthFormat.format(start)} a ${end.getUTCDate()} de ${endMonth}`;
}

export const demoVisits = [
  { day: "Segunda", visits: 2, recruiters: 0 },
  { day: "Terça", visits: 3, recruiters: 0 },
  { day: "Quarta", visits: 6, recruiters: 2 },
  { day: "Quinta", visits: 4, recruiters: 0 },
  { day: "Sexta", visits: 7, recruiters: 2 },
  { day: "Sábado", visits: 5, recruiters: 1 },
  { day: "Domingo", visits: 4, recruiters: 1 },
];
