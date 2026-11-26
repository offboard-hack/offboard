export type SeedJobMatch = {
  caseName: string;
  jobIndex: number;
  score: number;
  reasons: string[];
};

export const seedJobMatches: SeedJobMatch[] = [
  {
    caseName: "Marina Lopes",
    jobIndex: 0,
    score: 94,
    reasons: [
      "Seus 6 anos em marketing e a experiência com campanhas combinam com a vaga.",
      "Você acompanha métricas e relatórios de desempenho, como a vaga pede.",
    ],
  },
  {
    caseName: "Marina Lopes",
    jobIndex: 1,
    score: 89,
    reasons: [
      "Seu foco em crescimento mensurável se alinha à vaga.",
      "Você tem experiência com mídia paga, usada nos experimentos de crescimento.",
    ],
  },
  {
    caseName: "Marina Lopes",
    jobIndex: 2,
    score: 86,
    reasons: [
      "Mídia paga, e-mail marketing e SEO cobrem os canais da vaga.",
      "Você já planejou e acompanhou campanhas de ponta a ponta.",
    ],
  },
  {
    caseName: "Marina Lopes",
    jobIndex: 3,
    score: 85,
    reasons: [
      "Sua experiência com comunicação e campanhas ajuda a alinhar mensagens.",
      "A vaga pede posicionamento de produto, algo que seu currículo mostra pouco.",
    ],
  },
  {
    caseName: "Marina Lopes",
    jobIndex: 4,
    score: 83,
    reasons: [
      "Sua régua de e-mail marketing e o uso de HubSpot cobrem o dia a dia da vaga.",
      "A vaga pede foco em recompra, que seu currículo ainda não mostra.",
    ],
  },
];
