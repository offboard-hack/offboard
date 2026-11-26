import type { ResumeContent, ResumeScoreBreakdown } from "./schema/index.ts";

export type SeedResume = {
  caseName: string;
  scoreBreakdown: ResumeScoreBreakdown;
  scoredDaysAgo: number;
  content: ResumeContent;
  suggestions: {
    targetNodeId: string;
    suggestedText: string;
    rationale: string;
    criterion: string;
    estimatedGain: number;
  }[];
};

function breakdown(points: Record<string, [number, number, string]>) {
  return Object.fromEntries(
    Object.entries(points).map(([criterion, [earned, max, reason]]) => [
      criterion,
      { points: earned, max, reason },
    ]),
  ) satisfies ResumeScoreBreakdown;
}

export const seedResumes: SeedResume[] = [
  {
    caseName: "Marina Lopes",
    scoreBreakdown: breakdown({
      results: [14, 20, "A maioria das experiências traz números de resultado."],
      keywords: [11, 15, "Mídia paga, CRM e SEO aparecem; faltam ferramentas no resumo."],
      clarity: [13, 15, "Bullets curtos e diretos."],
      structure: [
        15,
        15,
        "Título, resumo, experiências com datas, formação, competências e contato.",
      ],
      actionVerbs: [9, 10, "Quase todos os bullets começam com verbo de ação."],
      summary: [8, 10, "Diz área e senioridade; falta um resultado concreto."],
      consistency: [8, 10, "Um relatório sem resultado destoa dos demais bullets."],
      length: [4, 5, "Densidade boa, uma experiência com poucos bullets."],
    }),
    scoredDaysAgo: 2,
    suggestions: [
      {
        targetNodeId: "5b1f0a10-0000-4000-8000-000000000011",
        suggestedText:
          "Liderou campanhas de mídia paga com investimento mensal de R$ 250 mil, reduzindo o custo de aquisição em 28% e gerando [valor] em vendas.",
        rationale:
          "Diga quanto as campanhas venderam: troque o trecho entre colchetes pelo valor real, que dá escala ao resultado.",
        criterion: "results",
        estimatedGain: 4,
      },
      {
        targetNodeId: "5b1f0a10-0000-4000-8000-000000000022",
        suggestedText:
          "Montou relatórios mensais de desempenho de campanhas para a diretoria, que embasaram [decisão tomada a partir dos relatórios].",
        rationale:
          "Mostre o resultado do relatório: troque o trecho entre colchetes pela decisão que ele influenciou.",
        criterion: "results",
        estimatedGain: 4,
      },
      {
        targetNodeId: "5b1f0a10-0000-4000-8000-000000000002",
        suggestedText:
          "Analista de marketing com 6 anos de experiência em mídia paga, CRM, SEO e conteúdo, usando HubSpot, focada em crescimento mensurável e campanhas orientadas por dados.",
        rationale:
          "Traga para o resumo as competências que você já lista, como SEO e HubSpot: são palavras-chave comuns nas vagas da área.",
        criterion: "keywords",
        estimatedGain: 3,
      },
    ],
    content: {
      headline: { id: "5b1f0a10-0000-4000-8000-000000000001", text: "Analista de Marketing" },
      summary: {
        id: "5b1f0a10-0000-4000-8000-000000000002",
        text: "Analista de marketing com 6 anos de experiência em mídia paga, CRM e conteúdo, focada em crescimento mensurável e campanhas orientadas por dados.",
      },
      experiences: [
        {
          id: "5b1f0a10-0000-4000-8000-000000000010",
          company: "Lumina Digital",
          role: "Analista de Marketing Sênior",
          start: "2022-03",
          end: null,
          bullets: [
            {
              id: "5b1f0a10-0000-4000-8000-000000000011",
              text: "Liderou campanhas de mídia paga com investimento mensal de R$ 250 mil, reduzindo o custo de aquisição em 28%.",
            },
            {
              id: "5b1f0a10-0000-4000-8000-000000000012",
              text: "Estruturou a régua de e-mail marketing e aumentou a taxa de abertura de 18% para 31%.",
            },
            {
              id: "5b1f0a10-0000-4000-8000-000000000013",
              text: "Coordenou um time de 3 pessoas e a agência de conteúdo parceira.",
            },
          ],
        },
        {
          id: "5b1f0a10-0000-4000-8000-000000000020",
          company: "Studio Alvorada",
          role: "Analista de Marketing",
          start: "2019-02",
          end: "2022-02",
          bullets: [
            {
              id: "5b1f0a10-0000-4000-8000-000000000021",
              text: "Planejou o calendário editorial e dobrou o tráfego orgânico do blog em 18 meses.",
            },
            {
              id: "5b1f0a10-0000-4000-8000-000000000022",
              text: "Montou relatórios mensais de desempenho de campanhas para a diretoria.",
            },
          ],
        },
      ],
      education: [
        {
          id: "5b1f0a10-0000-4000-8000-000000000030",
          institution: "Universidade de São Paulo",
          degree: "Bacharelado em Comunicação Social",
          start: "2014",
          end: "2018",
        },
      ],
      skills: [
        { id: "5b1f0a10-0000-4000-8000-000000000040", name: "Mídia paga" },
        { id: "5b1f0a10-0000-4000-8000-000000000041", name: "E-mail marketing" },
        { id: "5b1f0a10-0000-4000-8000-000000000042", name: "SEO" },
        { id: "5b1f0a10-0000-4000-8000-000000000043", name: "HubSpot" },
        { id: "5b1f0a10-0000-4000-8000-000000000044", name: "Gestão de campanhas" },
      ],
      languages: [
        { id: "5b1f0a10-0000-4000-8000-000000000050", name: "Português", level: "Nativo" },
        { id: "5b1f0a10-0000-4000-8000-000000000051", name: "Inglês", level: "Avançado" },
      ],
      contact: {
        email: "marina.lopes@exemplo.com",
        phone: null,
        city: "São Paulo",
        links: [],
      },
    },
  },
];

const cohortResume = (index: number, caseName: string, email: string) => {
  const id = (node: number) => `6c0a000${index}-0000-4000-8000-${String(node).padStart(12, "0")}`;

  return {
    caseName,
    scoreBreakdown: breakdown({
      results: [10 + index, 20, "Metade dos bullets traz resultado."],
      keywords: [10, 15, "Termos de operações presentes."],
      clarity: [12, 15, "Bullets claros."],
      structure: [15, 15, "Todas as seções presentes."],
      actionVerbs: [7, 10, "A maioria começa com verbo de ação."],
      summary: [6, 10, "Resumo genérico."],
      consistency: [7, 10, "Tempos verbais misturados."],
      length: [3, 5, "Poucos bullets por experiência."],
    }),
    scoredDaysAgo: 3,
    suggestions: [],
    content: {
      headline: { id: id(1), text: "Profissional de Operações" },
      summary: {
        id: id(2),
        text: "Profissional com experiência em operações, atendimento e melhoria de processos.",
      },
      experiences: [
        {
          id: id(10),
          company: "Empresa Exemplo",
          role: "Analista de Operações",
          start: "2021-01",
          end: null,
          bullets: [{ id: id(11), text: "Reduziu o tempo médio de atendimento em 20%." }],
        },
      ],
      education: [],
      skills: [{ id: id(40), name: "Gestão de processos" }],
      languages: [{ id: id(50), name: "Português", level: "Nativo" }],
      contact: { email, phone: null, city: "São Paulo", links: [] },
    },
  } satisfies SeedResume;
};

export const seedCohortResumes: SeedResume[] = [
  ["Rafael Mendes", "rafael.mendes"],
  ["Bianca Souza", "bianca.souza"],
  ["André Lima", "andre.lima"],
  ["Nina Castro", "nina.castro"],
  ["Gustavo Ribeiro", "gustavo.ribeiro"],
  ["Carla Mendonça", "carla.mendonca"],
  ["Felipe Oliveira", "felipe.oliveira"],
].map(([name, local], index) => cohortResume(index + 1, name, `${local}@exemplo.com`));

export type SeedTailoredResume = {
  caseName: string;
  jobIndex: number;
  status: "ready" | "draft";
  matchScore: number;
  updatedHoursAgo: number;
  content: ResumeContent;
};

type Tailoring = {
  headline: string;
  summary: string;
  bullets: Record<string, string>;
  dropBullets: string[];
  experienceOrder: string[];
  skillOrder: string[];
};

const marinaBase = seedResumes[0].content;

const tailor = (base: ResumeContent, tailoring: Tailoring) => ({
  ...base,
  headline: { ...base.headline, text: tailoring.headline },
  summary: { ...base.summary, text: tailoring.summary },
  experiences: tailoring.experienceOrder.flatMap((id) =>
    base.experiences
      .filter((experience) => experience.id === id)
      .map((experience) => ({
        ...experience,
        bullets: experience.bullets
          .filter((bullet) => !tailoring.dropBullets.includes(bullet.id))
          .map((bullet) => ({ ...bullet, text: tailoring.bullets[bullet.id] ?? bullet.text })),
      })),
  ),
  skills: tailoring.skillOrder.flatMap((id) => base.skills.filter((skill) => skill.id === id)),
});

export const seedTailoredResumes: SeedTailoredResume[] = [
  {
    caseName: "Marina Lopes",
    jobIndex: 0,
    status: "ready",
    matchScore: 92,
    updatedHoursAgo: 30,
    content: tailor(marinaBase, {
      headline: "Analista de Marketing Pleno em Mídia Paga e CRM",
      summary:
        "Analista de marketing com 6 anos de experiência em mídia paga, CRM e conteúdo, com foco em campanhas orientadas por dados e crescimento mensurável.",
      bullets: {
        "5b1f0a10-0000-4000-8000-000000000011":
          "Liderou campanhas de mídia paga com investimento mensal de R$ 250 mil e reduziu o custo de aquisição em 28%.",
        "5b1f0a10-0000-4000-8000-000000000012":
          "Estruturou a régua de e-mail marketing e elevou a taxa de abertura de 18% para 31%.",
        "5b1f0a10-0000-4000-8000-000000000022":
          "Montou relatórios mensais de desempenho das campanhas para a diretoria, apoiando decisões de investimento.",
      },
      dropBullets: ["5b1f0a10-0000-4000-8000-000000000013"],
      experienceOrder: [
        "5b1f0a10-0000-4000-8000-000000000010",
        "5b1f0a10-0000-4000-8000-000000000020",
      ],
      skillOrder: [
        "5b1f0a10-0000-4000-8000-000000000040",
        "5b1f0a10-0000-4000-8000-000000000044",
        "5b1f0a10-0000-4000-8000-000000000041",
        "5b1f0a10-0000-4000-8000-000000000043",
        "5b1f0a10-0000-4000-8000-000000000042",
      ],
    }),
  },
  {
    caseName: "Marina Lopes",
    jobIndex: 4,
    status: "draft",
    matchScore: 85,
    updatedHoursAgo: 36,
    content: tailor(marinaBase, {
      headline: "Analista de Marketing com foco em CRM e E-mail Marketing",
      summary:
        "Analista de marketing com 6 anos de experiência em CRM, e-mail marketing e mídia paga, acostumada a transformar dados de campanhas em decisões.",
      bullets: {
        "5b1f0a10-0000-4000-8000-000000000012":
          "Estruturou a régua de e-mail marketing e elevou a taxa de abertura de 18% para 31%.",
        "5b1f0a10-0000-4000-8000-000000000022":
          "Montou relatórios mensais de desempenho das campanhas para a diretoria.",
      },
      dropBullets: ["5b1f0a10-0000-4000-8000-000000000021"],
      experienceOrder: [
        "5b1f0a10-0000-4000-8000-000000000010",
        "5b1f0a10-0000-4000-8000-000000000020",
      ],
      skillOrder: [
        "5b1f0a10-0000-4000-8000-000000000041",
        "5b1f0a10-0000-4000-8000-000000000043",
        "5b1f0a10-0000-4000-8000-000000000044",
        "5b1f0a10-0000-4000-8000-000000000040",
      ],
    }),
  },
];
