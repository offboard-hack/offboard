export type SeedJob = {
  origin: "external" | "hr" | "recruiter";
  source: string;
  sourceKey: string;
  title: string;
  company: string;
  workModel: "remote" | "hybrid" | "onsite";
  city: string | null;
  state: string | null;
  salaryMinCents: number | null;
  salaryMaxCents: number | null;
  url: string;
  description: string;
  postedAt: Date;
};

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

const seedJob = (job: Omit<SeedJob, "source" | "sourceKey">) =>
  ({ ...job, source: "seed", sourceKey: job.url }) satisfies SeedJob;

export const seedJobs: SeedJob[] = [
  seedJob({
    origin: "external",
    title: "Analista de Marketing Pleno",
    company: "Mercado Fino",
    workModel: "hybrid",
    city: "São Paulo",
    state: "SP",
    salaryMinCents: 750000,
    salaryMaxCents: 900000,
    url: "https://vagas.example.com/mercado-fino/analista-de-marketing-pleno",
    description:
      "Planeje e execute campanhas de aquisição e retenção, acompanhando métricas de funil e orçamento.",
    postedAt: daysAgo(1),
  }),
  seedJob({
    origin: "hr",
    title: "Analista de Growth",
    company: "Ponte Pagamentos",
    workModel: "remote",
    city: null,
    state: null,
    salaryMinCents: 800000,
    salaryMaxCents: 1000000,
    url: "https://carreiras.example.com/ponte-pagamentos/analista-de-growth",
    description:
      "Conduza experimentos de crescimento em produto e canais pagos, com foco em ativação de clientes.",
    postedAt: daysAgo(3),
  }),
  seedJob({
    origin: "recruiter",
    title: "Analista de Marketing Digital",
    company: "Casa Viva",
    workModel: "hybrid",
    city: "Campinas",
    state: "SP",
    salaryMinCents: null,
    salaryMaxCents: null,
    url: "https://vagas.example.com/casa-viva/analista-de-marketing-digital",
    description:
      "Gerencie mídia paga, e-mail e redes sociais de uma marca de decoração em expansão.",
    postedAt: daysAgo(6),
  }),
  seedJob({
    origin: "external",
    title: "Analista de Marketing de Produto",
    company: "Nuvem Alta Software",
    workModel: "remote",
    city: null,
    state: null,
    salaryMinCents: 700000,
    salaryMaxCents: 850000,
    url: "https://vagas.example.com/nuvem-alta-software/analista-de-marketing-de-produto",
    description:
      "Posicione lançamentos de produto, produza materiais de venda e alinhe mensagens com times comerciais.",
    postedAt: daysAgo(10),
  }),
];
