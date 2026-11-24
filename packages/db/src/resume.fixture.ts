import type { ResumeContent } from "./schema/index.ts";

export type SeedResume = {
  caseName: string;
  content: ResumeContent;
};

export const seedResumes: SeedResume[] = [
  {
    caseName: "Marina Lopes",
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
