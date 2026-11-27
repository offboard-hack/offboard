export const demoProfiles = [
  {
    slug: "marina-lopes",
    name: "Marina Lopes",
    content: {
      headline: { text: "Engenheira de Software Sênior" },
      summary: {
        text: "Engenheira backend com 9 anos de experiência construindo APIs de alta vazão em Go. Foco em sistemas de pagamentos, observabilidade e mentoria de pessoas desenvolvedoras mais juniores.",
      },
      experiences: [
        {
          company: "Tauá Pagamentos",
          role: "Engenheira de Software Sênior",
          start: "2021-03",
          end: null,
          bullets: [
            {
              text: "Projetou o serviço de conciliação em Go que processa 3 milhões de transações por dia.",
            },
            {
              text: "Reduziu a latência p99 da API de cobrança de 800 ms para 120 ms com cache e filas.",
            },
          ],
        },
        {
          company: "Caatinga Software",
          role: "Desenvolvedora Backend Pleno",
          start: "2018-02",
          end: "2021-02",
          bullets: [
            {
              text: "Migrou um monólito PHP para microsserviços em Go, cortando custos de infraestrutura em 35%.",
            },
            { text: "Implantou tracing distribuído com OpenTelemetry em 14 serviços." },
          ],
        },
      ],
      education: [
        {
          institution: "UFPE",
          degree: "Bacharelado em Ciência da Computação",
          start: "2012",
          end: "2016",
        },
      ],
      skills: [
        { name: "Go" },
        { name: "PostgreSQL" },
        { name: "Kafka" },
        { name: "Docker" },
        { name: "Kubernetes" },
        { name: "gRPC" },
        { name: "OpenTelemetry" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
      ],
      contact: { email: null, phone: null, city: "Recife, PE", links: [] },
    },
  },
  {
    slug: "rafael-nogueira",
    name: "Rafael Nogueira",
    content: {
      headline: { text: "Tech Lead Backend Java" },
      summary: {
        text: "Tech lead com foco em plataformas de crédito e arquitetura orientada a eventos. Lidera times pequenos priorizando qualidade, entregas previsíveis e desenvolvimento de pessoas.",
      },
      experiences: [
        {
          company: "Araucária Crédito",
          role: "Tech Lead",
          start: "2020-06",
          end: null,
          bullets: [
            {
              text: "Liderou time de 6 pessoas responsável pelo motor de análise de crédito em Java e Spring.",
            },
            { text: "Reduziu o tempo de aprovação de crédito de 2 dias para 4 minutos." },
            {
              text: "Introduziu revisão de design e cobertura mínima de 80%, caindo 60% dos incidentes.",
            },
          ],
        },
        {
          company: "Pinhão Sistemas",
          role: "Desenvolvedor Java Sênior",
          start: "2015-08",
          end: "2020-05",
          bullets: [
            { text: "Desenvolveu o módulo de faturamento usado por 200 clientes corporativos." },
            {
              text: "Automatizou o deploy com Jenkins, passando de releases mensais para semanais.",
            },
          ],
        },
      ],
      education: [
        {
          institution: "UFPR",
          degree: "Bacharelado em Sistemas de Informação",
          start: "2010",
          end: "2014",
        },
      ],
      skills: [
        { name: "Java" },
        { name: "Spring Boot" },
        { name: "Kafka" },
        { name: "PostgreSQL" },
        { name: "AWS" },
        { name: "Liderança técnica" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "Curitiba, PR", links: [] },
    },
  },
  {
    slug: "camila-furtado",
    name: "Camila Furtado",
    content: {
      headline: { text: "Desenvolvedora Frontend Pleno" },
      summary: {
        text: "Desenvolvedora frontend apaixonada por acessibilidade e performance web. Trabalha com React e TypeScript em produtos de comércio eletrônico.",
      },
      experiences: [
        {
          company: "Jangada Marketplace",
          role: "Desenvolvedora Frontend",
          start: "2022-01",
          end: null,
          bullets: [
            { text: "Reconstruiu o checkout em React, aumentando a conversão em 11%." },
            {
              text: "Melhorou o LCP de 4,2 s para 1,8 s com code splitting e otimização de imagens.",
            },
            { text: "Corrigiu 120 problemas de acessibilidade apontados em auditoria WCAG." },
          ],
        },
        {
          company: "Estúdio Maré",
          role: "Desenvolvedora Web Júnior",
          start: "2020-03",
          end: "2021-12",
          bullets: [
            {
              text: "Entregou 15 sites institucionais responsivos para clientes de pequeno porte.",
            },
          ],
        },
      ],
      education: [
        {
          institution: "UFSC",
          degree: "Bacharelado em Ciências da Computação",
          start: "2016",
          end: "2020",
        },
      ],
      skills: [
        { name: "React" },
        { name: "TypeScript" },
        { name: "Next.js" },
        { name: "Acessibilidade" },
        { name: "Jest" },
        { name: "Tailwind CSS" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Intermediário" },
        { name: "Espanhol", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "Florianópolis, SC", links: [] },
    },
  },
  {
    slug: "diego-azevedo",
    name: "Diego Azevedo",
    content: {
      headline: { text: "Engenheiro Mobile Android" },
      summary: {
        text: "Engenheiro Android com 7 anos de experiência em apps de grande escala. Especialista em Kotlin, Jetpack Compose e arquitetura modular.",
      },
      experiences: [
        {
          company: "Veredas Mobilidade",
          role: "Engenheiro Android Sênior",
          start: "2020-09",
          end: null,
          bullets: [
            {
              text: "Migrou o app de 2 milhões de usuários para Jetpack Compose e arquitetura modular.",
            },
            {
              text: "Reduziu o crash rate de 1,8% para 0,3% com monitoramento e testes de instrumentação.",
            },
          ],
        },
        {
          company: "Gerais Apps",
          role: "Desenvolvedor Android",
          start: "2017-04",
          end: "2020-08",
          bullets: [
            { text: "Publicou 6 aplicativos na Play Store com mais de 500 mil downloads somados." },
            { text: "Implementou pagamentos in-app e notificações push segmentadas." },
          ],
        },
      ],
      education: [
        {
          institution: "UFMG",
          degree: "Bacharelado em Sistemas de Informação",
          start: "2012",
          end: "2016",
        },
      ],
      skills: [
        { name: "Kotlin" },
        { name: "Android" },
        { name: "Jetpack Compose" },
        { name: "Coroutines" },
        { name: "Firebase" },
        { name: "CI/CD" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "Belo Horizonte, MG", links: [] },
    },
  },
  {
    slug: "juliana-prado",
    name: "Juliana Prado",
    content: {
      headline: { text: "Engenheira de Dados Sênior" },
      summary: {
        text: "Engenheira de dados com experiência em pipelines em larga escala e data lakes para varejo. Gosta de transformar dados brutos em produtos confiáveis para analistas e cientistas.",
      },
      experiences: [
        {
          company: "Bandeira Varejo",
          role: "Engenheira de Dados Sênior",
          start: "2019-11",
          end: null,
          bullets: [
            {
              text: "Construiu o data lakehouse com Spark e Airflow, consolidando 40 fontes de dados.",
            },
            { text: "Cortou o tempo de fechamento diário de vendas de 6 horas para 40 minutos." },
            {
              text: "Criou testes de qualidade de dados que evitaram 25 incidentes em relatórios executivos.",
            },
          ],
        },
        {
          company: "Cobalto Analytics",
          role: "Analista de Dados",
          start: "2016-07",
          end: "2019-10",
          bullets: [
            {
              text: "Automatizou 30 relatórios manuais usando Python e SQL, economizando 120 horas por mês.",
            },
          ],
        },
      ],
      education: [
        { institution: "USP", degree: "Bacharelado em Estatística", start: "2012", end: "2015" },
        { institution: "Insper", degree: "MBA em Data Science", start: "2019", end: "2021" },
      ],
      skills: [
        { name: "Python" },
        { name: "Spark" },
        { name: "Airflow" },
        { name: "SQL" },
        { name: "dbt" },
        { name: "BigQuery" },
        { name: "Data quality" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
        { name: "Francês", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "São Paulo, SP", links: [] },
    },
  },
  {
    slug: "thiago-bezerra",
    name: "Thiago Bezerra",
    content: {
      headline: { text: "Engenheiro de Machine Learning" },
      summary: {
        text: "Engenheiro de ML que leva modelos de pesquisa à produção. Experiência com NLP em português, sistemas de recomendação e MLOps.",
      },
      experiences: [
        {
          company: "Sertão Digital",
          role: "Engenheiro de Machine Learning",
          start: "2021-05",
          end: null,
          bullets: [
            {
              text: "Treinou um classificador de textos em português com 94% de F1 para triagem de atendimento.",
            },
            { text: "Colocou 7 modelos em produção com MLflow e monitoramento de drift." },
          ],
        },
        {
          company: "Laboratório Alisios",
          role: "Pesquisador Júnior",
          start: "2019-03",
          end: "2021-04",
          bullets: [
            { text: "Publicou 2 artigos sobre embeddings para textos jurídicos em português." },
          ],
        },
      ],
      education: [
        {
          institution: "UFC",
          degree: "Mestrado em Ciência da Computação",
          start: "2019",
          end: "2021",
        },
        {
          institution: "UFC",
          degree: "Bacharelado em Ciência da Computação",
          start: "2014",
          end: "2018",
        },
      ],
      skills: [
        { name: "Python" },
        { name: "PyTorch" },
        { name: "NLP" },
        { name: "MLflow" },
        { name: "Embeddings" },
        { name: "Docker" },
        { name: "SQL" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
      ],
      contact: { email: null, phone: null, city: "Fortaleza, CE", links: [] },
    },
  },
  {
    slug: "larissa-mendonca",
    name: "Larissa Mendonça",
    content: {
      headline: { text: "Engenheira de Confiabilidade (SRE)" },
      summary: {
        text: "SRE com foco em disponibilidade, resposta a incidentes e infraestrutura como código. Ajuda times de produto a definir SLOs realistas.",
      },
      experiences: [
        {
          company: "Pampa Cloud",
          role: "SRE Sênior",
          start: "2020-02",
          end: null,
          bullets: [
            { text: "Elevou a disponibilidade da plataforma de 99,5% para 99,95% em 18 meses." },
            { text: "Escreveu os runbooks e conduziu 40 post-mortems sem culpados." },
            { text: "Reduziu o custo de nuvem em 28% com right-sizing e instâncias spot." },
          ],
        },
        {
          company: "Gaúcha Telecom",
          role: "Analista de Infraestrutura",
          start: "2016-09",
          end: "2020-01",
          bullets: [
            { text: "Automatizou provisionamento com Terraform e Ansible para 300 servidores." },
          ],
        },
      ],
      education: [
        {
          institution: "UFRGS",
          degree: "Bacharelado em Engenharia de Computação",
          start: "2011",
          end: "2016",
        },
      ],
      skills: [
        { name: "Kubernetes" },
        { name: "Terraform" },
        { name: "Prometheus" },
        { name: "Grafana" },
        { name: "AWS" },
        { name: "Go" },
        { name: "Linux" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
        { name: "Alemão", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "Porto Alegre, RS", links: [] },
    },
  },
  {
    slug: "bruno-teixeira",
    name: "Bruno Teixeira",
    content: {
      headline: { text: "Analista de QA e Automação de Testes" },
      summary: {
        text: "Analista de qualidade com 6 anos de experiência em automação de testes de API e interface. Trabalha próximo de desenvolvedores para prevenir defeitos antes da produção.",
      },
      experiences: [
        {
          company: "Cerrado Saúde Digital",
          role: "Analista de QA Pleno",
          start: "2020-08",
          end: null,
          bullets: [
            { text: "Criou suíte de 900 testes automatizados com Cypress e Playwright." },
            { text: "Reduziu o ciclo de regressão de 3 dias para 2 horas." },
          ],
        },
        {
          company: "Buriti Sistemas",
          role: "Analista de Testes Júnior",
          start: "2018-05",
          end: "2020-07",
          bullets: [
            {
              text: "Executou testes manuais e exploratórios em 4 produtos, registrando mais de 600 defeitos.",
            },
          ],
        },
      ],
      education: [
        {
          institution: "UFG",
          degree: "Tecnologia em Análise e Desenvolvimento de Sistemas",
          start: "2015",
          end: "2018",
        },
      ],
      skills: [
        { name: "Cypress" },
        { name: "Playwright" },
        { name: "Postman" },
        { name: "JavaScript" },
        { name: "Testes de API" },
        { name: "Jira" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Goiânia, GO", links: [] },
    },
  },
  {
    slug: "patricia-viana",
    name: "Patrícia Viana",
    content: {
      headline: { text: "Engenheira de Segurança da Informação" },
      summary: {
        text: "Especialista em segurança de aplicações e conformidade com a LGPD. Atua com pentest, threat modeling e programas de segurança para o setor público e financeiro.",
      },
      experiences: [
        {
          company: "Planalto Seguros",
          role: "Engenheira de Segurança Sênior",
          start: "2019-04",
          end: null,
          bullets: [
            { text: "Implantou programa de AppSec que reduziu vulnerabilidades críticas em 70%." },
            { text: "Conduziu o projeto de adequação à LGPD em 22 sistemas." },
          ],
        },
        {
          company: "Esplanada Consultoria",
          role: "Analista de Segurança",
          start: "2015-06",
          end: "2019-03",
          bullets: [
            {
              text: "Realizou 35 testes de intrusão em órgãos públicos e emitiu relatórios com plano de correção.",
            },
          ],
        },
      ],
      education: [
        {
          institution: "UnB",
          degree: "Bacharelado em Engenharia de Redes",
          start: "2010",
          end: "2014",
        },
      ],
      skills: [
        { name: "Pentest" },
        { name: "OWASP" },
        { name: "LGPD" },
        { name: "Threat modeling" },
        { name: "Burp Suite" },
        { name: "Python" },
        { name: "SIEM" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
        { name: "Espanhol", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Brasília, DF", links: [] },
    },
  },
  {
    slug: "gabriel-sampaio",
    name: "Gabriel Sampaio",
    content: {
      headline: { text: "Desenvolvedor Backend Júnior" },
      summary: {
        text: "Desenvolvedor júnior em Node.js com um ano de experiência em APIs REST. Aprende rápido e busca um time onde possa crescer com mentoria.",
      },
      experiences: [
        {
          company: "Potiguar Tech",
          role: "Desenvolvedor Backend Júnior",
          start: "2025-02",
          end: null,
          bullets: [
            { text: "Desenvolveu 12 endpoints REST em Node.js e Fastify para um app de delivery." },
            {
              text: "Escreveu testes que elevaram a cobertura do módulo de pedidos de 30% para 85%.",
            },
          ],
        },
        {
          company: "Potiguar Tech",
          role: "Estagiário de Desenvolvimento",
          start: "2024-02",
          end: "2025-01",
          bullets: [{ text: "Corrigiu mais de 50 bugs e migrou scripts legados para TypeScript." }],
        },
      ],
      education: [
        {
          institution: "UFRN",
          degree: "Bacharelado em Tecnologia da Informação",
          start: "2020",
          end: null,
        },
      ],
      skills: [
        { name: "Node.js" },
        { name: "TypeScript" },
        { name: "Fastify" },
        { name: "PostgreSQL" },
        { name: "Git" },
        { name: "Docker" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Natal, RN", links: [] },
    },
  },
  {
    slug: "fernanda-quintana",
    name: "Fernanda Quintana",
    content: {
      headline: { text: "Head de Engenharia" },
      summary: {
        text: "Líder de engenharia com 15 anos de carreira, 8 deles gerindo times. Escala organizações de tecnologia em fintechs, equilibrando cultura, entrega e custo.",
      },
      experiences: [
        {
          company: "Carnaúba Bank",
          role: "Head de Engenharia",
          start: "2020-01",
          end: null,
          bullets: [
            { text: "Lidera 40 pessoas em 6 squads de produtos bancários e de infraestrutura." },
            {
              text: "Estruturou plano de carreira técnico e reduziu o turnover da engenharia de 25% para 9%.",
            },
            { text: "Conduziu a migração para nuvem, economizando R$ 2 milhões por ano." },
          ],
        },
        {
          company: "Ipê Fintech",
          role: "Gerente de Engenharia",
          start: "2016-03",
          end: "2019-12",
          bullets: [
            {
              text: "Liderou time de 15 pessoas e levou a plataforma de 10 mil para 800 mil usuários.",
            },
          ],
        },
        {
          company: "Ipê Fintech",
          role: "Engenheira de Software",
          start: "2011-02",
          end: "2016-02",
          bullets: [{ text: "Desenvolveu o núcleo de contas em Java, usado em toda a empresa." }],
        },
      ],
      education: [
        {
          institution: "USP",
          degree: "Bacharelado em Engenharia Elétrica",
          start: "2006",
          end: "2010",
        },
        {
          institution: "FGV",
          degree: "MBA Executivo em Gestão de Negócios",
          start: "2018",
          end: "2019",
        },
      ],
      skills: [
        { name: "Gestão de engenharia" },
        { name: "Contratação" },
        { name: "Arquitetura" },
        { name: "OKRs" },
        { name: "Orçamento" },
        { name: "Java" },
        { name: "Mentoria" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
        { name: "Espanhol", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "São Paulo, SP", links: [] },
    },
  },
  {
    slug: "lucas-ferraz",
    name: "Lucas Ferraz",
    content: {
      headline: { text: "Engenheiro Backend Python" },
      summary: {
        text: "Engenheiro backend remoto com experiência em Django, FastAPI e integrações com bancos e meios de pagamento. Prefere times assíncronos e documentação clara.",
      },
      experiences: [
        {
          company: "Ágata Plataformas",
          role: "Engenheiro Backend Pleno",
          start: "2021-10",
          end: null,
          bullets: [
            { text: "Construiu APIs em FastAPI que atendem 1,5 milhão de requisições por dia." },
            { text: "Integrou 5 adquirentes de pagamento com camada de abstração única." },
          ],
        },
        {
          company: "Rio Doce Soluções",
          role: "Desenvolvedor Python",
          start: "2018-08",
          end: "2021-09",
          bullets: [
            {
              text: "Modernizou um sistema Django legado e reduziu o tempo de resposta médio em 45%.",
            },
          ],
        },
      ],
      education: [
        {
          institution: "UFES",
          degree: "Bacharelado em Ciência da Computação",
          start: "2013",
          end: "2017",
        },
      ],
      skills: [
        { name: "Python" },
        { name: "FastAPI" },
        { name: "Django" },
        { name: "PostgreSQL" },
        { name: "Redis" },
        { name: "Celery" },
        { name: "AWS" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
      ],
      contact: { email: null, phone: null, city: "Remoto", links: [] },
    },
  },
  {
    slug: "aline-coutinho",
    name: "Aline Coutinho",
    content: {
      headline: { text: "Gerente de Ciência de Dados" },
      summary: {
        text: "Gerente de ciência de dados que já liderou times de dados em seguros e varejo. Conecta modelos preditivos a metas de negócio e desenvolve analistas e cientistas.",
      },
      experiences: [
        {
          company: "Farol Seguros",
          role: "Gerente de Ciência de Dados",
          start: "2020-07",
          end: null,
          bullets: [
            { text: "Lidera time de 11 cientistas e engenheiros de dados." },
            {
              text: "Lançou o modelo de precificação dinâmica que aumentou a margem em 4 pontos percentuais.",
            },
            { text: "Criou a prática de experimentação, rodando 30 testes A/B por ano." },
          ],
        },
        {
          company: "Copacabana Varejo",
          role: "Cientista de Dados Sênior",
          start: "2016-05",
          end: "2020-06",
          bullets: [
            {
              text: "Liderou time de 4 pessoas no modelo de previsão de demanda, reduzindo a ruptura de estoque em 18%.",
            },
          ],
        },
      ],
      education: [
        { institution: "PUC-Rio", degree: "Mestrado em Informática", start: "2013", end: "2015" },
        {
          institution: "UFRJ",
          degree: "Bacharelado em Matemática Aplicada",
          start: "2008",
          end: "2012",
        },
      ],
      skills: [
        { name: "Ciência de dados" },
        { name: "Python" },
        { name: "Estatística" },
        { name: "Testes A/B" },
        { name: "Gestão de times de dados" },
        { name: "SQL" },
        { name: "Previsão de demanda" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
        { name: "Francês", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Rio de Janeiro, RJ", links: [] },
    },
  },
  {
    slug: "mateus-arruda",
    name: "Mateus Arruda",
    content: {
      headline: { text: "Engenheiro DevOps" },
      summary: {
        text: "Engenheiro DevOps focado em pipelines de entrega contínua e containers. Já apoiou migrações de data center para nuvem em indústrias de grande porte.",
      },
      experiences: [
        {
          company: "Amazônia Industrial",
          role: "Engenheiro DevOps",
          start: "2019-10",
          end: null,
          bullets: [
            { text: "Criou pipelines com GitLab CI usados por 25 equipes de desenvolvimento." },
            {
              text: "Migrou 80 aplicações para Kubernetes, reduzindo o tempo de deploy de 2 horas para 8 minutos.",
            },
          ],
        },
        {
          company: "Rio Negro TI",
          role: "Analista de Suporte e Infraestrutura",
          start: "2016-02",
          end: "2019-09",
          bullets: [
            { text: "Administrou servidores Linux e virtualização VMware para 500 usuários." },
          ],
        },
      ],
      education: [
        {
          institution: "UFAM",
          degree: "Bacharelado em Engenharia da Computação",
          start: "2011",
          end: "2015",
        },
      ],
      skills: [
        { name: "Kubernetes" },
        { name: "GitLab CI" },
        { name: "Terraform" },
        { name: "Azure" },
        { name: "Linux" },
        { name: "Bash" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Intermediário" },
        { name: "Espanhol", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Manaus, AM", links: [] },
    },
  },
  {
    slug: "isabela-moraes",
    name: "Isabela Moraes",
    content: {
      headline: { text: "Estagiária de Engenharia de Software" },
      summary: {
        text: "Estudante de Ciência da Computação em busca de oportunidade em desenvolvimento web. Participa de maratonas de programação e projetos de extensão.",
      },
      experiences: [
        {
          company: "Ibirapuera Labs",
          role: "Estagiária de Engenharia de Software",
          start: "2025-06",
          end: null,
          bullets: [
            {
              text: "Desenvolveu telas em React para o painel interno de suporte, usado por 60 atendentes.",
            },
            { text: "Escreveu testes unitários que cobriram 70% dos componentes novos." },
          ],
        },
      ],
      education: [
        {
          institution: "Unicamp",
          degree: "Bacharelado em Ciência da Computação",
          start: "2022",
          end: null,
        },
      ],
      skills: [
        { name: "JavaScript" },
        { name: "React" },
        { name: "Python" },
        { name: "Git" },
        { name: "SQL" },
        { name: "Algoritmos" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
        { name: "Libras", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "Campinas, SP", links: [] },
    },
  },
  {
    slug: "henrique-dallagnol",
    name: "Henrique Dallagnol",
    content: {
      headline: { text: "Staff Engineer" },
      summary: {
        text: "Staff engineer com 16 anos de experiência em sistemas distribuídos. Define arquitetura entre times, escreve RFCs e atua como referência técnica em fintech e e-commerce.",
      },
      experiences: [
        {
          company: "Colônia Commerce",
          role: "Staff Engineer",
          start: "2020-03",
          end: null,
          bullets: [
            {
              text: "Desenhou a arquitetura de eventos que sustentou o pico de 12 mil pedidos por minuto na Black Friday.",
            },
            { text: "Instituiu o processo de RFCs, adotado por 9 times." },
          ],
        },
        {
          company: "Serra Gaúcha Software",
          role: "Arquiteto de Software",
          start: "2014-01",
          end: "2020-02",
          bullets: [
            { text: "Liderou a decomposição de um monólito em 20 serviços." },
            { text: "Mentorou 8 engenheiros, 3 deles promovidos a sênior." },
          ],
        },
      ],
      education: [
        {
          institution: "UFRGS",
          degree: "Bacharelado em Ciência da Computação",
          start: "2005",
          end: "2009",
        },
      ],
      skills: [
        { name: "Arquitetura distribuída" },
        { name: "Java" },
        { name: "Go" },
        { name: "Kafka" },
        { name: "Domain-Driven Design" },
        { name: "AWS" },
        { name: "Mentoria" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
        { name: "Alemão", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "Porto Alegre, RS", links: [] },
    },
  },
  {
    slug: "sofia-cavalcante",
    name: "Sofia Cavalcante",
    content: {
      headline: { text: "Desenvolvedora Backend Go" },
      summary: {
        text: "Desenvolvedora Go com 4 anos de experiência em microsserviços e mensageria. Gosta de código simples, testes e boas práticas de observabilidade.",
      },
      experiences: [
        {
          company: "Frevo Logística Digital",
          role: "Desenvolvedora Backend Pleno",
          start: "2022-04",
          end: null,
          bullets: [
            {
              text: "Implementou o serviço de roteirização em Go que atende 20 mil entregas por dia.",
            },
            {
              text: "Adotou testes de contrato entre 8 serviços, reduzindo falhas de integração em 50%.",
            },
          ],
        },
        {
          company: "Manguezal Tech",
          role: "Desenvolvedora Backend Júnior",
          start: "2021-01",
          end: "2022-03",
          bullets: [
            { text: "Construiu APIs REST em Go e Gin para o aplicativo de uma rede de farmácias." },
          ],
        },
      ],
      education: [
        {
          institution: "CESAR School",
          degree: "Bacharelado em Engenharia de Software",
          start: "2017",
          end: "2021",
        },
      ],
      skills: [
        { name: "Go" },
        { name: "RabbitMQ" },
        { name: "PostgreSQL" },
        { name: "Docker" },
        { name: "gRPC" },
        { name: "Redis" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
        { name: "Espanhol", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Recife, PE", links: [] },
    },
  },
  {
    slug: "vitor-hugo-lima",
    name: "Vitor Hugo Lima",
    content: {
      headline: { text: "Desenvolvedor iOS Sênior" },
      summary: {
        text: "Desenvolvedor iOS com foco em Swift e SwiftUI. Já entregou apps de turismo e saúde com milhares de avaliações positivas.",
      },
      experiences: [
        {
          company: "Recôncavo Apps",
          role: "Desenvolvedor iOS Sênior",
          start: "2019-06",
          end: null,
          bullets: [
            { text: "Liderou o app de turismo com 800 mil downloads e nota 4,8 na App Store." },
            { text: "Adotou SwiftUI e Swift Concurrency, reduzindo o código de interface em 30%." },
          ],
        },
        {
          company: "Pelourinho Digital",
          role: "Desenvolvedor Mobile",
          start: "2016-09",
          end: "2019-05",
          bullets: [{ text: "Desenvolveu aplicativos híbridos e nativos para 10 clientes." }],
        },
      ],
      education: [
        {
          institution: "UFBA",
          degree: "Bacharelado em Ciência da Computação",
          start: "2011",
          end: "2016",
        },
      ],
      skills: [
        { name: "Swift" },
        { name: "SwiftUI" },
        { name: "Objective-C" },
        { name: "Combine" },
        { name: "XCTest" },
        { name: "Fastlane" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Salvador, BA", links: [] },
    },
  },
  {
    slug: "renata-okamoto",
    name: "Renata Okamoto",
    content: {
      headline: { text: "Gerente de Engenharia" },
      summary: {
        text: "Gerente de engenharia que combina visão técnica e gestão de pessoas. Já liderou times de plataforma e de produto em empresas de software B2B.",
      },
      experiences: [
        {
          company: "Ônix Software",
          role: "Gerente de Engenharia",
          start: "2021-02",
          end: null,
          bullets: [
            {
              text: "Gerencia 3 times e 12 pessoas desenvolvedoras na plataforma de gestão de frotas.",
            },
            {
              text: "Reduziu o lead time de entrega de 21 para 6 dias com trunk-based development.",
            },
          ],
        },
        {
          company: "Ônix Software",
          role: "Tech Lead",
          start: "2018-03",
          end: "2021-01",
          bullets: [
            {
              text: "Liderou time de 5 pessoas no redesenho da API pública, adotada por 150 integradores.",
            },
          ],
        },
      ],
      education: [
        {
          institution: "UTFPR",
          degree: "Bacharelado em Engenharia de Computação",
          start: "2010",
          end: "2015",
        },
      ],
      skills: [
        { name: "Gestão de pessoas" },
        { name: "Node.js" },
        { name: "Arquitetura de APIs" },
        { name: "Feedback" },
        { name: "Planejamento" },
        { name: "AWS" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
        { name: "Japonês", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "Curitiba, PR", links: [] },
    },
  },
  {
    slug: "caio-menezes",
    name: "Caio Menezes",
    content: {
      headline: { text: "Desenvolvedor de Jogos Unity" },
      summary: {
        text: "Desenvolvedor de jogos mobile com experiência em gameplay, monetização e otimização de desempenho em Unity. Já trabalhou em títulos casuais com milhões de jogadores.",
      },
      experiences: [
        {
          company: "Pixel Itacolomi",
          role: "Desenvolvedor de Jogos Pleno",
          start: "2020-05",
          end: null,
          bullets: [
            {
              text: "Programou o sistema de progressão de um jogo casual com 3 milhões de instalações.",
            },
            {
              text: "Aumentou a retenção de dia 7 de 9% para 14% ajustando o tutorial e a economia.",
            },
          ],
        },
        {
          company: "Estúdio Jabuticaba",
          role: "Desenvolvedor de Jogos Júnior",
          start: "2018-01",
          end: "2020-04",
          bullets: [{ text: "Entregou 3 jogos para Android e iOS em ciclos de 4 meses." }],
        },
      ],
      education: [
        {
          institution: "PUC Minas",
          degree: "Bacharelado em Jogos Digitais",
          start: "2014",
          end: "2017",
        },
      ],
      skills: [
        { name: "Unity" },
        { name: "C#" },
        { name: "Game design" },
        { name: "Otimização" },
        { name: "Monetização" },
        { name: "Shaders" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "Belo Horizonte, MG", links: [] },
    },
  },
  {
    slug: "tatiane-barros",
    name: "Tatiane Barros",
    content: {
      headline: { text: "Analytics Engineer" },
      summary: {
        text: "Analytics engineer brasileira baseada em Lisboa, com experiência em modelagem de dados com dbt e BI para empresas de e-commerce e turismo.",
      },
      experiences: [
        {
          company: "Tejo Viagens",
          role: "Analytics Engineer",
          start: "2022-09",
          end: null,
          bullets: [
            { text: "Modelou 150 tabelas em dbt que alimentam os painéis de receita e ocupação." },
            {
              text: "Padronizou métricas de negócio, eliminando 3 definições conflitantes de receita.",
            },
          ],
        },
        {
          company: "Vitória Moda Online",
          role: "Analista de BI",
          start: "2019-02",
          end: "2022-08",
          bullets: [{ text: "Construiu painéis em Looker usados diariamente por 80 pessoas." }],
        },
      ],
      education: [
        {
          institution: "UFES",
          degree: "Bacharelado em Sistemas de Informação",
          start: "2014",
          end: "2018",
        },
      ],
      skills: [
        { name: "dbt" },
        { name: "SQL" },
        { name: "Snowflake" },
        { name: "Looker" },
        { name: "Python" },
        { name: "Modelagem dimensional" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
        { name: "Espanhol", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "Lisboa, Portugal", links: [] },
    },
  },
  {
    slug: "andre-pacheco",
    name: "André Pacheco",
    content: {
      headline: { text: "Engenheiro de Dados Sênior no setor de energia" },
      summary: {
        text: "Engenheiro de dados com experiência em telemetria e séries temporais para geração e distribuição de energia. Combina conhecimento de engenharia elétrica com pipelines de dados.",
      },
      experiences: [
        {
          company: "Tucuruí Energia Renovável",
          role: "Engenheiro de Dados Sênior",
          start: "2020-08",
          end: null,
          bullets: [
            {
              text: "Construiu pipeline de telemetria que ingere 50 milhões de leituras por dia de usinas solares.",
            },
            { text: "Habilitou manutenção preditiva que reduziu paradas não planejadas em 22%." },
          ],
        },
        {
          company: "Guamá Distribuidora",
          role: "Engenheiro Eletricista",
          start: "2015-03",
          end: "2020-07",
          bullets: [
            {
              text: "Analisou perdas de energia em 40 alimentadores e propôs ações que economizaram R$ 3 milhões.",
            },
          ],
        },
      ],
      education: [
        {
          institution: "UFPA",
          degree: "Bacharelado em Engenharia Elétrica",
          start: "2009",
          end: "2014",
        },
      ],
      skills: [
        { name: "Python" },
        { name: "Séries temporais" },
        { name: "Spark" },
        { name: "InfluxDB" },
        { name: "Kafka" },
        { name: "SQL" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "Belém, PA", links: [] },
    },
  },
  {
    slug: "beatriz-andrade",
    name: "Beatriz Andrade",
    content: {
      headline: { text: "Product Manager Sênior em Fintech" },
      summary: {
        text: "Gerente de produto com 8 anos em pagamentos e crédito. Combina descoberta com clientes, dados e priorização rigorosa para lançar produtos financeiros.",
      },
      experiences: [
        {
          company: "Tauá Pagamentos",
          role: "Product Manager Sênior",
          start: "2021-04",
          end: null,
          bullets: [
            {
              text: "Lançou o Pix parcelado, que atingiu R$ 80 milhões em volume nos primeiros 6 meses.",
            },
            { text: "Reduziu o churn de lojistas em 17% com um novo fluxo de onboarding." },
          ],
        },
        {
          company: "Moeda Verde",
          role: "Product Manager",
          start: "2018-01",
          end: "2021-03",
          bullets: [
            { text: "Definiu o roadmap do cartão de crédito, que alcançou 300 mil clientes." },
          ],
        },
      ],
      education: [
        {
          institution: "FGV",
          degree: "Bacharelado em Administração de Empresas",
          start: "2010",
          end: "2014",
        },
      ],
      skills: [
        { name: "Gestão de produto" },
        { name: "Discovery" },
        { name: "Roadmap" },
        { name: "SQL" },
        { name: "Pagamentos" },
        { name: "Crédito" },
        { name: "OKRs" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
      ],
      contact: { email: null, phone: null, city: "São Paulo, SP", links: [] },
    },
  },
  {
    slug: "leonardo-fontes",
    name: "Leonardo Fontes",
    content: {
      headline: { text: "Head de Produto" },
      summary: {
        text: "Head de produto com trajetória em varejo e mídia. Constrói organizações de produto, define estratégia e conduz times multifuncionais até resultados mensuráveis.",
      },
      experiences: [
        {
          company: "Guanabara Media",
          role: "Head de Produto",
          start: "2019-08",
          end: null,
          bullets: [
            { text: "Lidera 15 pessoas entre gerentes de produto, designers e analistas." },
            {
              text: "Estratégia de assinaturas que levou a receita recorrente de R$ 4 milhões para R$ 19 milhões.",
            },
          ],
        },
        {
          company: "Leblon Shopping Online",
          role: "Gerente de Produto",
          start: "2015-05",
          end: "2019-07",
          bullets: [
            {
              text: "Liderou o time do app de compras, cuja base cresceu de 100 mil para 1,2 milhão de usuários.",
            },
          ],
        },
      ],
      education: [
        {
          institution: "PUC-Rio",
          degree: "Bacharelado em Engenharia de Produção",
          start: "2008",
          end: "2013",
        },
      ],
      skills: [
        { name: "Estratégia de produto" },
        { name: "Gestão de times" },
        { name: "Monetização" },
        { name: "Experimentação" },
        { name: "Métricas de produto" },
        { name: "Assinaturas" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
        { name: "Italiano", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Rio de Janeiro, RJ", links: [] },
    },
  },
  {
    slug: "carolina-bastos",
    name: "Carolina Bastos",
    content: {
      headline: { text: "Designer de Produto e UX" },
      summary: {
        text: "Designer de UX com experiência em fintech e pesquisa com usuários. Cria fluxos claros para públicos diversos, incluindo pessoas com baixa familiaridade digital.",
      },
      experiences: [
        {
          company: "Mandacaru Crédito",
          role: "Designer de Produto Sênior",
          start: "2020-11",
          end: null,
          bullets: [
            {
              text: "Redesenhou o fluxo de contratação de empréstimo e aumentou a conclusão de 38% para 61%.",
            },
            {
              text: "Conduziu 60 entrevistas com usuários e criou a biblioteca de pesquisa da empresa.",
            },
          ],
        },
        {
          company: "Agência Tangerina",
          role: "Designer UX",
          start: "2017-03",
          end: "2020-10",
          bullets: [{ text: "Entregou projetos de UX para 12 clientes de bancos e seguros." }],
        },
      ],
      education: [
        {
          institution: "Belas Artes de São Paulo",
          degree: "Bacharelado em Design Gráfico",
          start: "2012",
          end: "2016",
        },
      ],
      skills: [
        { name: "Figma" },
        { name: "Pesquisa com usuários" },
        { name: "Design de interação" },
        { name: "Design system" },
        { name: "Prototipação" },
        { name: "Testes de usabilidade" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "São Paulo, SP", links: [] },
    },
  },
  {
    slug: "pedro-ibrahim",
    name: "Pedro Ibrahim",
    content: {
      headline: { text: "Designer de Interfaces (UI)" },
      summary: {
        text: "Designer de UI com forte base visual e domínio de design systems. Trabalha lado a lado com frontend para manter consistência e qualidade.",
      },
      experiences: [
        {
          company: "Ouro Verde Educação",
          role: "Designer de UI Pleno",
          start: "2022-02",
          end: null,
          bullets: [
            { text: "Criou o design system com 80 componentes, adotado por 4 produtos." },
            { text: "Redesenhou o app de alunos, elevando a nota na loja de 3,9 para 4,6." },
          ],
        },
        {
          company: "Estúdio Cedro",
          role: "Designer Gráfico",
          start: "2019-06",
          end: "2022-01",
          bullets: [
            {
              text: "Produziu identidades visuais e materiais digitais para mais de 30 marcas locais.",
            },
          ],
        },
      ],
      education: [
        { institution: "UTFPR", degree: "Bacharelado em Design", start: "2015", end: "2019" },
      ],
      skills: [
        { name: "Figma" },
        { name: "Design system" },
        { name: "Tipografia" },
        { name: "Motion design" },
        { name: "Acessibilidade" },
        { name: "Illustrator" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Intermediário" },
        { name: "Árabe", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "Curitiba, PR", links: [] },
    },
  },
  {
    slug: "yasmin-carvalho",
    name: "Yasmin Carvalho",
    content: {
      headline: { text: "Analista de Dados e BI" },
      summary: {
        text: "Analista de dados que transforma números em decisões para áreas comerciais e financeiras. Domina SQL, Power BI e storytelling com dados.",
      },
      experiences: [
        {
          company: "Recôncavo Atacado",
          role: "Analista de Dados Pleno",
          start: "2021-06",
          end: null,
          bullets: [
            { text: "Construiu 25 painéis em Power BI que substituíram planilhas em 6 áreas." },
            { text: "Identificou clientes inativos e gerou R$ 1,3 milhão em reativações." },
          ],
        },
        {
          company: "Dendê Consultoria",
          role: "Analista Júnior",
          start: "2019-03",
          end: "2021-05",
          bullets: [
            {
              text: "Automatizou a consolidação de indicadores mensais, economizando 40 horas por mês.",
            },
          ],
        },
      ],
      education: [
        { institution: "UFBA", degree: "Bacharelado em Estatística", start: "2015", end: "2019" },
      ],
      skills: [
        { name: "SQL" },
        { name: "Power BI" },
        { name: "Excel avançado" },
        { name: "Python" },
        { name: "Storytelling com dados" },
        { name: "Estatística" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Salvador, BA", links: [] },
    },
  },
  {
    slug: "rodrigo-sato",
    name: "Rodrigo Sato",
    content: {
      headline: { text: "Executivo de Vendas B2B SaaS" },
      summary: {
        text: "Vendedor consultivo B2B com 7 anos vendendo software para médias e grandes empresas. Ciclos de venda complexos, múltiplos decisores e metas agressivas.",
      },
      experiences: [
        {
          company: "Pau-Brasil Software",
          role: "Executivo de Contas Sênior",
          start: "2020-03",
          end: null,
          bullets: [
            {
              text: "Bateu 128% da meta anual em 2024, fechando R$ 5,4 milhões em novos contratos.",
            },
            { text: "Fechou 3 contas enterprise com ticket acima de R$ 500 mil." },
          ],
        },
        {
          company: "Pau-Brasil Software",
          role: "SDR e Executivo de Vendas",
          start: "2017-08",
          end: "2020-02",
          bullets: [
            {
              text: "Gerou 400 reuniões qualificadas em prospecção ativa e passou a fechar contas de médio porte.",
            },
          ],
        },
      ],
      education: [
        { institution: "ESPM", degree: "Bacharelado em Administração", start: "2012", end: "2016" },
      ],
      skills: [
        { name: "Venda consultiva" },
        { name: "Prospecção outbound" },
        { name: "Negociação" },
        { name: "CRM" },
        { name: "SPIN Selling" },
        { name: "Forecast" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "São Paulo, SP", links: [] },
    },
  },
  {
    slug: "amanda-guimaraes",
    name: "Amanda Guimarães",
    content: {
      headline: { text: "Gerente de Contas B2B" },
      summary: {
        text: "Gerente de contas que cuida de carteiras estratégicas de indústria e logística. Foco em relacionamento de longo prazo, expansão e renovação.",
      },
      experiences: [
        {
          company: "Bromélia Embalagens",
          role: "Gerente de Contas",
          start: "2019-09",
          end: null,
          bullets: [
            {
              text: "Administra carteira de 35 clientes industriais que somam R$ 22 milhões por ano.",
            },
            { text: "Aumentou a receita da carteira em 24% com vendas cruzadas." },
          ],
        },
        {
          company: "Bromélia Embalagens",
          role: "Representante Comercial",
          start: "2016-04",
          end: "2019-08",
          bullets: [{ text: "Abriu 40 novos clientes na região de Campinas." }],
        },
      ],
      education: [
        {
          institution: "PUC-Campinas",
          degree: "Bacharelado em Administração",
          start: "2011",
          end: "2015",
        },
      ],
      skills: [
        { name: "Gestão de carteira" },
        { name: "Venda B2B" },
        { name: "Negociação" },
        { name: "Renovação de contratos" },
        { name: "Salesforce" },
        { name: "Excel" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Espanhol", level: "Avançado" },
        { name: "Inglês", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "Campinas, SP", links: [] },
    },
  },
  {
    slug: "felipe-vasconcelos",
    name: "Felipe Vasconcelos",
    content: {
      headline: { text: "Diretor Comercial" },
      summary: {
        text: "Diretor comercial com 18 anos de vendas, sendo 10 em liderança. Estrutura áreas comerciais, define metas e forma gestores em empresas de tecnologia e serviços.",
      },
      experiences: [
        {
          company: "Baía de Guanabara Tecnologia",
          role: "Diretor Comercial",
          start: "2018-05",
          end: null,
          bullets: [
            { text: "Lidera 25 pessoas entre vendas, pré-vendas e operações comerciais." },
            { text: "Triplicou a receita em 4 anos, de R$ 18 milhões para R$ 56 milhões." },
            { text: "Implantou o processo de forecast com 92% de precisão." },
          ],
        },
        {
          company: "Sapucaí Serviços",
          role: "Gerente Comercial",
          start: "2012-02",
          end: "2018-04",
          bullets: [{ text: "Liderou equipe de 10 vendedores e abriu a operação de São Paulo." }],
        },
      ],
      education: [
        { institution: "UFRJ", degree: "Bacharelado em Administração", start: "2004", end: "2008" },
        { institution: "Coppead", degree: "MBA em Gestão Comercial", start: "2014", end: "2015" },
      ],
      skills: [
        { name: "Gestão comercial" },
        { name: "Liderança de vendas" },
        { name: "Planejamento de metas" },
        { name: "Forecast" },
        { name: "Negociação enterprise" },
        { name: "Parcerias" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
        { name: "Espanhol", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "Rio de Janeiro, RJ", links: [] },
    },
  },
  {
    slug: "luciana-peixoto",
    name: "Luciana Peixoto",
    content: {
      headline: { text: "Customer Success Manager" },
      summary: {
        text: "CSM com foco em retenção e expansão de clientes B2B de software. Cria playbooks, mede saúde da carteira e atua como voz do cliente dentro do produto.",
      },
      experiences: [
        {
          company: "Inconfidência Software",
          role: "Customer Success Manager",
          start: "2020-10",
          end: null,
          bullets: [
            { text: "Gerencia carteira de 60 clientes com R$ 9 milhões de receita recorrente." },
            { text: "Elevou a retenção líquida de 96% para 108% com planos de sucesso e upsell." },
          ],
        },
        {
          company: "Geraes Telecom",
          role: "Analista de Atendimento Sênior",
          start: "2016-06",
          end: "2020-09",
          bullets: [{ text: "Treinou 20 atendentes e reduziu o tempo médio de resolução em 30%." }],
        },
      ],
      education: [
        {
          institution: "UFMG",
          degree: "Bacharelado em Comunicação Social",
          start: "2011",
          end: "2015",
        },
      ],
      skills: [
        { name: "Customer Success" },
        { name: "Retenção de clientes" },
        { name: "Onboarding" },
        { name: "Health score" },
        { name: "HubSpot" },
        { name: "Gestão de contas" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
        { name: "Espanhol", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Belo Horizonte, MG", links: [] },
    },
  },
  {
    slug: "matheus-brito",
    name: "Matheus Brito",
    content: {
      headline: { text: "Analista de Customer Success" },
      summary: {
        text: "Analista de CS em início de carreira, atendendo clientes de uma plataforma de gestão para pequenas empresas. Comunicativo, organizado e orientado a dados.",
      },
      experiences: [
        {
          company: "Barra Funda Gestão",
          role: "Analista de Customer Success",
          start: "2024-01",
          end: null,
          bullets: [
            { text: "Acompanha 90 clientes de pequeno porte e mantém churn mensal abaixo de 2%." },
            {
              text: "Criou 15 artigos na central de ajuda que reduziram em 20% os chamados repetidos.",
            },
          ],
        },
        {
          company: "Loja Esquina Digital",
          role: "Atendente de Suporte",
          start: "2022-03",
          end: "2023-12",
          bullets: [{ text: "Atendeu 60 chamados por dia com nota de satisfação de 4,7 de 5." }],
        },
      ],
      education: [
        {
          institution: "Estácio",
          degree: "Tecnologia em Gestão Comercial",
          start: "2021",
          end: "2023",
        },
      ],
      skills: [
        { name: "Atendimento ao cliente" },
        { name: "Zendesk" },
        { name: "Onboarding" },
        { name: "Comunicação" },
        { name: "Excel" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "Remoto", links: [] },
    },
  },
  {
    slug: "daniela-rocha",
    name: "Daniela Rocha",
    content: {
      headline: { text: "Analista de Marketing de Performance" },
      summary: {
        text: "Especialista em mídia paga e aquisição digital para e-commerce e SaaS. Otimiza campanhas por CAC, LTV e retorno sobre investimento.",
      },
      experiences: [
        {
          company: "Ilha Bela Turismo Digital",
          role: "Analista de Performance Sênior",
          start: "2021-03",
          end: null,
          bullets: [
            { text: "Gerencia R$ 600 mil por mês em mídia paga no Google e Meta." },
            { text: "Reduziu o CAC em 32% reestruturando campanhas e criativos." },
          ],
        },
        {
          company: "Agência Lagoa",
          role: "Analista de Mídia",
          start: "2018-05",
          end: "2021-02",
          bullets: [
            {
              text: "Operou campanhas para 15 clientes e dobrou os leads de uma conta de educação.",
            },
          ],
        },
      ],
      education: [
        {
          institution: "UDESC",
          degree: "Bacharelado em Publicidade e Propaganda",
          start: "2013",
          end: "2017",
        },
      ],
      skills: [
        { name: "Google Ads" },
        { name: "Meta Ads" },
        { name: "SEO" },
        { name: "Google Analytics" },
        { name: "CRO" },
        { name: "Funil de vendas" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "Florianópolis, SC", links: [] },
    },
  },
  {
    slug: "gustavo-tavares",
    name: "Gustavo Tavares",
    content: {
      headline: { text: "Head de Marketing para a América Latina" },
      summary: {
        text: "Líder de marketing brasileiro baseado em Buenos Aires, responsável por expansão regional de produtos digitais. Equilibra branding, geração de demanda e conteúdo.",
      },
      experiences: [
        {
          company: "Pampa Digital",
          role: "Head de Marketing LATAM",
          start: "2021-08",
          end: null,
          bullets: [
            { text: "Lidera 14 pessoas de marketing em Argentina, Chile, México e Brasil." },
            { text: "Lançou a operação na Argentina e atingiu 50 mil clientes em 10 meses." },
          ],
        },
        {
          company: "Iguaçu Consumo",
          role: "Gerente de Marketing",
          start: "2016-01",
          end: "2021-07",
          bullets: [
            {
              text: "Liderou time de 6 pessoas e elevou o reconhecimento de marca em 12 pontos percentuais.",
            },
          ],
        },
      ],
      education: [
        { institution: "ESPM", degree: "Bacharelado em Marketing", start: "2009", end: "2013" },
      ],
      skills: [
        { name: "Estratégia de marketing" },
        { name: "Branding" },
        { name: "Geração de demanda" },
        { name: "Gestão de orçamento" },
        { name: "Expansão internacional" },
        { name: "Liderança" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Espanhol", level: "Fluente" },
        { name: "Inglês", level: "Fluente" },
      ],
      contact: { email: null, phone: null, city: "Buenos Aires, Argentina", links: [] },
    },
  },
  {
    slug: "priscila-ramos",
    name: "Priscila Ramos",
    content: {
      headline: { text: "HR Business Partner" },
      summary: {
        text: "HRBP bilíngue em português e espanhol, com experiência em empresas multinacionais latino-americanas. Atua em cultura, desempenho, remuneração e relações trabalhistas.",
      },
      experiences: [
        {
          company: "Andes Brasil Indústria",
          role: "HR Business Partner",
          start: "2020-06",
          end: null,
          bullets: [
            { text: "Atende 600 pessoas colaboradoras em 3 fábricas e no escritório central." },
            { text: "Implantou ciclo de avaliação de desempenho com 95% de adesão." },
          ],
        },
        {
          company: "Andes Brasil Indústria",
          role: "Analista de RH",
          start: "2016-03",
          end: "2020-05",
          bullets: [
            {
              text: "Conduziu pesquisas de clima e planos de ação que elevaram o engajamento em 14 pontos.",
            },
          ],
        },
      ],
      education: [
        {
          institution: "Mackenzie",
          degree: "Bacharelado em Psicologia",
          start: "2011",
          end: "2015",
        },
        {
          institution: "FIA",
          degree: "Pós-graduação em Gestão de Pessoas",
          start: "2017",
          end: "2018",
        },
      ],
      skills: [
        { name: "Recursos humanos" },
        { name: "Relações trabalhistas" },
        { name: "Avaliação de desempenho" },
        { name: "Clima organizacional" },
        { name: "Remuneração" },
        { name: "Desenvolvimento de lideranças" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Espanhol", level: "Fluente" },
        { name: "Inglês", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "São Paulo, SP", links: [] },
    },
  },
  {
    slug: "joao-victor-lins",
    name: "João Victor Lins",
    content: {
      headline: { text: "Recrutador de Tecnologia" },
      summary: {
        text: "Recrutador especializado em perfis de tecnologia e produto. Conduz do alinhamento com gestores até a proposta, cuidando da experiência de quem se candidata.",
      },
      experiences: [
        {
          company: "Capibaribe Talentos",
          role: "Recrutador Tech Sênior",
          start: "2021-02",
          end: null,
          bullets: [
            { text: "Fechou 70 contratações de engenharia e produto em 2024." },
            { text: "Reduziu o tempo médio de contratação de 52 para 31 dias." },
          ],
        },
        {
          company: "Capibaribe Talentos",
          role: "Analista de Recrutamento",
          start: "2018-07",
          end: "2021-01",
          bullets: [
            { text: "Triou mais de 3 mil currículos por ano e estruturou o banco de talentos." },
          ],
        },
      ],
      education: [
        { institution: "UNICAP", degree: "Bacharelado em Psicologia", start: "2014", end: "2018" },
      ],
      skills: [
        { name: "Recrutamento técnico" },
        { name: "Sourcing" },
        { name: "Entrevista por competências" },
        { name: "LinkedIn Recruiter" },
        { name: "ATS" },
        { name: "Employer branding" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
        { name: "Espanhol", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "Recife, PE", links: [] },
    },
  },
  {
    slug: "elisa-monteiro",
    name: "Elisa Monteiro",
    content: {
      headline: { text: "Head de People e Cultura" },
      summary: {
        text: "Líder de pessoas em startups em crescimento, com atuação em cultura, remuneração e escalada de times remotos. Já levou empresas de 40 a 400 pessoas.",
      },
      experiences: [
        {
          company: "Nuvem Cerrado",
          role: "Head de People",
          start: "2020-04",
          end: null,
          bullets: [
            {
              text: "Lidera time de 9 pessoas em recrutamento, cultura e administração de pessoal.",
            },
            { text: "Escalou a empresa de 60 para 420 pessoas em operação 100% remota." },
            { text: "Criou a política de remuneração e níveis de carreira para todas as áreas." },
          ],
        },
        {
          company: "Cambuí Startups",
          role: "Gerente de RH",
          start: "2015-09",
          end: "2020-03",
          bullets: [{ text: "Estruturou o RH do zero e conduziu 150 contratações." }],
        },
      ],
      education: [
        {
          institution: "PUC-Campinas",
          degree: "Bacharelado em Psicologia",
          start: "2008",
          end: "2012",
        },
        { institution: "FGV", degree: "MBA em Gestão Empresarial", start: "2016", end: "2018" },
      ],
      skills: [
        { name: "People & Culture" },
        { name: "Gestão de times de RH" },
        { name: "Remuneração" },
        { name: "Cultura remota" },
        { name: "Plano de carreira" },
        { name: "Employer branding" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
        { name: "Espanhol", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "Remoto", links: [] },
    },
  },
  {
    slug: "marcelo-duarte",
    name: "Marcelo Duarte",
    content: {
      headline: { text: "Controller" },
      summary: {
        text: "Controller com experiência em indústria e agronegócio. Conduz fechamentos contábeis, orçamento e governança financeira, com foco em precisão e prazo.",
      },
      experiences: [
        {
          company: "Coxilha Agroindustrial",
          role: "Controller",
          start: "2018-07",
          end: null,
          bullets: [
            {
              text: "Lidera fechamento contábil de 5 empresas do grupo, com resultado consolidado em D+5.",
            },
            { text: "Implantou controles internos e reduziu os ajustes de auditoria em 60%." },
          ],
        },
        {
          company: "Vale do Taquari Alimentos",
          role: "Analista Contábil Sênior",
          start: "2012-03",
          end: "2018-06",
          bullets: [
            {
              text: "Responsável pelas demonstrações financeiras em IFRS e pelas obrigações fiscais.",
            },
          ],
        },
      ],
      education: [
        {
          institution: "UFRGS",
          degree: "Bacharelado em Ciências Contábeis",
          start: "2007",
          end: "2011",
        },
      ],
      skills: [
        { name: "Contabilidade" },
        { name: "IFRS" },
        { name: "Controladoria" },
        { name: "Orçamento" },
        { name: "SAP" },
        { name: "Auditoria" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Intermediário" },
        { name: "Alemão", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "Porto Alegre, RS", links: [] },
    },
  },
  {
    slug: "natalia-freitas",
    name: "Natália Freitas",
    content: {
      headline: { text: "Analista Financeira de FP&A" },
      summary: {
        text: "Analista de planejamento financeiro em empresas de tecnologia. Constrói modelos de orçamento, projeções de caixa e análises de unit economics.",
      },
      experiences: [
        {
          company: "Tamarindo Tecnologia",
          role: "Analista de FP&A Pleno",
          start: "2022-01",
          end: null,
          bullets: [
            { text: "Estruturou o orçamento anual de R$ 120 milhões com 12 áreas." },
            {
              text: "Criou o modelo de unit economics que orientou o corte de 15% de custos de aquisição.",
            },
          ],
        },
        {
          company: "Paulista Auditores",
          role: "Auditora Júnior",
          start: "2019-02",
          end: "2021-12",
          bullets: [{ text: "Auditou demonstrações financeiras de 20 empresas de médio porte." }],
        },
      ],
      education: [
        {
          institution: "FEA-USP",
          degree: "Bacharelado em Ciências Contábeis",
          start: "2014",
          end: "2018",
        },
      ],
      skills: [
        { name: "FP&A" },
        { name: "Modelagem financeira" },
        { name: "Excel avançado" },
        { name: "SQL" },
        { name: "Fluxo de caixa" },
        { name: "Power BI" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "São Paulo, SP", links: [] },
    },
  },
  {
    slug: "ricardo-albuquerque",
    name: "Ricardo Albuquerque",
    content: {
      headline: { text: "Gerente de Logística no Agronegócio" },
      summary: {
        text: "Gerente de logística com 14 anos de experiência no escoamento de grãos e insumos agrícolas. Otimiza rotas, armazenagem e custos de frete no Centro-Oeste.",
      },
      experiences: [
        {
          company: "Mandacaru Logística",
          role: "Gerente de Logística",
          start: "2019-01",
          end: null,
          bullets: [
            { text: "Coordena equipe de 18 pessoas e frota de 120 caminhões contratados." },
            {
              text: "Reduziu o custo de frete por tonelada em 11% renegociando rotas e contratos.",
            },
          ],
        },
        {
          company: "Pantanal Grãos",
          role: "Coordenador de Expedição",
          start: "2013-05",
          end: "2018-12",
          bullets: [{ text: "Operou a expedição de 1,2 milhão de toneladas por safra." }],
        },
      ],
      education: [
        {
          institution: "UFMT",
          degree: "Bacharelado em Engenharia de Produção",
          start: "2008",
          end: "2012",
        },
      ],
      skills: [
        { name: "Logística" },
        { name: "Gestão de frota" },
        { name: "Roteirização" },
        { name: "Armazenagem" },
        { name: "TMS" },
        { name: "Negociação de fretes" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Espanhol", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Cuiabá, MT", links: [] },
    },
  },
  {
    slug: "simone-cardoso",
    name: "Simone Cardoso",
    content: {
      headline: { text: "Coordenadora de Operações" },
      summary: {
        text: "Coordenadora de operações em centros de distribuição e atendimento. Melhora processos com lean, indicadores e treinamento de equipes.",
      },
      experiences: [
        {
          company: "Rio Solimões Distribuição",
          role: "Coordenadora de Operações",
          start: "2020-09",
          end: null,
          bullets: [
            { text: "Coordena 45 operadores em 3 turnos no centro de distribuição de Manaus." },
            { text: "Aumentou a produtividade de separação em 26% com layout e metas por turno." },
          ],
        },
        {
          company: "Rio Solimões Distribuição",
          role: "Supervisora de Estoque",
          start: "2016-04",
          end: "2020-08",
          bullets: [{ text: "Reduziu a divergência de inventário de 3,5% para 0,6%." }],
        },
      ],
      education: [
        { institution: "UEA", degree: "Tecnologia em Logística", start: "2012", end: "2015" },
      ],
      skills: [
        { name: "Operações logísticas" },
        { name: "Lean" },
        { name: "Gestão de estoque" },
        { name: "WMS" },
        { name: "Indicadores (KPIs)" },
        { name: "Treinamento de equipes" },
      ],
      languages: [{ name: "Português", level: "Nativo" }],
      contact: { email: null, phone: null, city: "Manaus, AM", links: [] },
    },
  },
  {
    slug: "fabio-nascimento",
    name: "Fábio Nascimento",
    content: {
      headline: { text: "Advogado Corporativo" },
      summary: {
        text: "Advogado com atuação em contratos, proteção de dados e regulatório para empresas de tecnologia e saúde. Prático, objetivo e próximo das áreas de negócio.",
      },
      experiences: [
        {
          company: "Esplanada Health",
          role: "Advogado Corporativo Sênior",
          start: "2019-03",
          end: null,
          bullets: [
            {
              text: "Revisa mais de 300 contratos por ano, com prazo médio de resposta de 2 dias.",
            },
            { text: "Conduziu a adequação à LGPD e criou o canal do titular de dados." },
          ],
        },
        {
          company: "Monteiro & Associados",
          role: "Advogado Associado",
          start: "2014-02",
          end: "2019-02",
          bullets: [
            {
              text: "Atuou em contencioso cível e empresarial, com 90 processos sob responsabilidade.",
            },
          ],
        },
      ],
      education: [
        { institution: "UnB", degree: "Bacharelado em Direito", start: "2009", end: "2013" },
        {
          institution: "IDP",
          degree: "Pós-graduação em Direito Digital",
          start: "2018",
          end: "2019",
        },
      ],
      skills: [
        { name: "Direito contratual" },
        { name: "LGPD" },
        { name: "Direito regulatório" },
        { name: "Compliance" },
        { name: "Negociação" },
        { name: "Contencioso cível" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "Brasília, DF", links: [] },
    },
  },
  {
    slug: "helena-siqueira",
    name: "Helena Siqueira",
    content: {
      headline: { text: "Enfermeira Gestora Hospitalar" },
      summary: {
        text: "Enfermeira com especialização em gestão hospitalar e qualidade assistencial. Lidera equipes de enfermagem e implanta protocolos de segurança do paciente.",
      },
      experiences: [
        {
          company: "Hospital Santa Luzia do Sul",
          role: "Gerente de Enfermagem",
          start: "2018-05",
          end: null,
          bullets: [
            { text: "Lidera 30 profissionais de enfermagem em 4 unidades de internação." },
            { text: "Reduziu infecções hospitalares em 40% com protocolos de higienização." },
            { text: "Conduziu a acreditação hospitalar, obtida em 14 meses." },
          ],
        },
        {
          company: "Clínica Vida Plena",
          role: "Enfermeira Assistencial",
          start: "2012-03",
          end: "2018-04",
          bullets: [
            { text: "Coordenou o atendimento de urgência com mais de 200 pacientes por dia." },
          ],
        },
      ],
      education: [
        { institution: "UFPR", degree: "Bacharelado em Enfermagem", start: "2007", end: "2011" },
        {
          institution: "Hospital Albert Einstein",
          degree: "Especialização em Gestão em Saúde",
          start: "2016",
          end: "2017",
        },
      ],
      skills: [
        { name: "Gestão de enfermagem" },
        { name: "Segurança do paciente" },
        { name: "Acreditação hospitalar" },
        { name: "Protocolos clínicos" },
        { name: "Gestão de escalas" },
        { name: "Indicadores assistenciais" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Intermediário" },
        { name: "Libras", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Curitiba, PR", links: [] },
    },
  },
  {
    slug: "paulo-kuhn",
    name: "Paulo Kuhn",
    content: {
      headline: { text: "Gerente de Produto em Edtech, ex-professor" },
      summary: {
        text: "Ex-professor de matemática que migrou para produto em educação. Une vivência de sala de aula e métodos de produto para criar experiências de aprendizagem.",
      },
      experiences: [
        {
          company: "Escola Digital Itajaí",
          role: "Gerente de Produto",
          start: "2021-08",
          end: null,
          bullets: [
            { text: "Lançou a plataforma de exercícios adaptativos usada por 120 mil estudantes." },
            { text: "Aumentou o engajamento semanal de alunos em 35% com trilhas personalizadas." },
          ],
        },
        {
          company: "Colégio Vale do Itajaí",
          role: "Professor de Matemática",
          start: "2013-02",
          end: "2021-07",
          bullets: [
            {
              text: "Lecionou para turmas do ensino médio e elevou a aprovação em vestibulares em 20%.",
            },
            { text: "Coordenou o laboratório de tecnologia educacional da escola." },
          ],
        },
      ],
      education: [
        { institution: "FURB", degree: "Licenciatura em Matemática", start: "2008", end: "2012" },
        {
          institution: "Product School",
          degree: "Curso de Gestão de Produto",
          start: "2020",
          end: "2020",
        },
      ],
      skills: [
        { name: "Gestão de produto" },
        { name: "Educação" },
        { name: "Pesquisa com usuários" },
        { name: "Aprendizagem adaptativa" },
        { name: "SQL" },
        { name: "Didática" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Alemão", level: "Intermediário" },
        { name: "Inglês", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Joinville, SC", links: [] },
    },
  },
  {
    slug: "vanessa-oliveira",
    name: "Vanessa Oliveira",
    content: {
      headline: { text: "Conteudista e Designer Instrucional em Edtech" },
      summary: {
        text: "Professora de língua portuguesa que atua como designer instrucional. Cria cursos acessíveis, com foco em inclusão e comunicação em Libras.",
      },
      experiences: [
        {
          company: "Aprender Mais Plataforma",
          role: "Designer Instrucional",
          start: "2022-03",
          end: null,
          bullets: [
            { text: "Produziu 45 cursos online acessíveis, com legendas e vídeos em Libras." },
            { text: "Treinou 25 professores conteudistas em metodologias ativas." },
          ],
        },
        {
          company: "Rede Municipal de Ensino de Teresina",
          role: "Professora de Português",
          start: "2015-02",
          end: "2022-02",
          bullets: [
            { text: "Lecionou para 8 turmas e liderou projeto de leitura que atingiu 900 alunos." },
          ],
        },
      ],
      education: [
        {
          institution: "UFPI",
          degree: "Licenciatura em Letras Português",
          start: "2010",
          end: "2014",
        },
        {
          institution: "Coursera",
          degree: "Especialização em Design Instrucional",
          start: "2021",
          end: "2022",
        },
      ],
      skills: [
        { name: "Design instrucional" },
        { name: "Produção de conteúdo" },
        { name: "Acessibilidade" },
        { name: "Moodle" },
        { name: "Metodologias ativas" },
        { name: "Roteiro de vídeo" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Libras", level: "Fluente" },
        { name: "Inglês", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "Teresina, PI", links: [] },
    },
  },
  {
    slug: "igor-pimentel",
    name: "Igor Pimentel",
    content: {
      headline: { text: "Gerente de Produto em Agtech" },
      summary: {
        text: "Gerente de produto com formação em agronomia, focado em soluções digitais para produtores rurais. Entende o campo e traduz necessidades em produtos.",
      },
      experiences: [
        {
          company: "Safra Viva Agtech",
          role: "Gerente de Produto",
          start: "2021-01",
          end: null,
          bullets: [
            {
              text: "Lançou o app de monitoramento de lavouras com imagens de satélite, usado em 1,8 milhão de hectares.",
            },
            { text: "Fechou 40 pilotos com cooperativas, convertendo 28 em contratos anuais." },
          ],
        },
        {
          company: "Cooperativa Planalto Central",
          role: "Engenheiro Agrônomo",
          start: "2016-03",
          end: "2020-12",
          bullets: [{ text: "Prestou assistência técnica a 120 produtores de soja e milho." }],
        },
      ],
      education: [
        { institution: "UFMT", degree: "Bacharelado em Agronomia", start: "2011", end: "2015" },
      ],
      skills: [
        { name: "Gestão de produto" },
        { name: "Agronegócio" },
        { name: "Agricultura de precisão" },
        { name: "Discovery" },
        { name: "Análise de dados" },
        { name: "Parcerias" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Espanhol", level: "Avançado" },
        { name: "Inglês", level: "Intermediário" },
      ],
      contact: { email: null, phone: null, city: "Cuiabá, MT", links: [] },
    },
  },
  {
    slug: "monica-esteves",
    name: "Mônica Esteves",
    content: {
      headline: { text: "Diretora Financeira (CFO)" },
      summary: {
        text: "CFO com 20 anos de carreira em finanças corporativas, captação e M&A. Baseada em Lisboa, apoia empresas brasileiras e portuguesas em expansão internacional.",
      },
      experiences: [
        {
          company: "Atlântico Capital Partners",
          role: "Diretora Financeira",
          start: "2019-09",
          end: null,
          bullets: [
            { text: "Lidera área financeira de 20 pessoas entre Lisboa e São Paulo." },
            { text: "Captou 45 milhões de euros em rodada de crescimento e emissões de dívida." },
            { text: "Conduziu 3 aquisições, integrando operações em 6 meses." },
          ],
        },
        {
          company: "Bandeirantes Holding",
          role: "Gerente Financeira",
          start: "2013-04",
          end: "2019-08",
          bullets: [
            { text: "Liderou equipe de 8 pessoas em tesouraria e planejamento financeiro." },
          ],
        },
      ],
      education: [
        {
          institution: "FGV-EAESP",
          degree: "Bacharelado em Administração de Empresas",
          start: "2002",
          end: "2006",
        },
        {
          institution: "Nova School of Business and Economics",
          degree: "MBA Executivo",
          start: "2017",
          end: "2018",
        },
      ],
      skills: [
        { name: "Finanças corporativas" },
        { name: "M&A" },
        { name: "Captação de recursos" },
        { name: "Relação com investidores" },
        { name: "Gestão de times financeiros" },
        { name: "Tesouraria" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Inglês", level: "Fluente" },
        { name: "Francês", level: "Avançado" },
      ],
      contact: { email: null, phone: null, city: "Lisboa, Portugal", links: [] },
    },
  },
  {
    slug: "carlos-eduardo-spina",
    name: "Carlos Eduardo Spina",
    content: {
      headline: { text: "Analista de Suporte Técnico Júnior" },
      summary: {
        text: "Analista de suporte com um ano e meio de experiência atendendo clientes de software de gestão. Busca crescer para customer success ou QA.",
      },
      experiences: [
        {
          company: "Capixaba Sistemas",
          role: "Analista de Suporte Júnior",
          start: "2024-08",
          end: null,
          bullets: [
            { text: "Resolve em média 35 chamados por dia, com 92% de satisfação." },
            {
              text: "Documentou 40 procedimentos que reduziram o tempo de treinamento de novos analistas em 25%.",
            },
          ],
        },
        {
          company: "Loja Vitória Eletro",
          role: "Auxiliar Administrativo",
          start: "2023-01",
          end: "2024-07",
          bullets: [
            {
              text: "Cuidou de cadastros e faturamento de 500 clientes e apoiou a migração para novo sistema.",
            },
          ],
        },
      ],
      education: [
        { institution: "IFES", degree: "Técnico em Informática", start: "2020", end: "2022" },
      ],
      skills: [
        { name: "Suporte técnico" },
        { name: "SQL básico" },
        { name: "Atendimento ao cliente" },
        { name: "Zendesk" },
        { name: "Documentação" },
      ],
      languages: [
        { name: "Português", level: "Nativo" },
        { name: "Italiano", level: "Básico" },
      ],
      contact: { email: null, phone: null, city: "Vitória, ES", links: [] },
    },
  },
] as const satisfies readonly {
  slug: string;
  name: string;
  content: {
    headline: { text: string };
    summary: { text: string };
    experiences: readonly {
      company: string;
      role: string;
      start: string;
      end: string | null;
      bullets: readonly { text: string }[];
    }[];
    education: readonly {
      institution: string;
      degree: string;
      start: string | null;
      end: string | null;
    }[];
    skills: readonly { name: string }[];
    languages: readonly { name: string; level: string | null }[];
    contact: { email: null; phone: null; city: string; links: readonly [] };
  };
}[];
