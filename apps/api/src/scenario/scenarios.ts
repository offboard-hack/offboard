import type { ScenarioName } from "./args.js";
import { addDays, type Context } from "./context.js";
import {
  draftAiApply,
  improveWithAi,
  recordApplications,
  rejectJobs,
  saveAnswers,
} from "./steps-career.js";
import { payBenefitCopay } from "./steps-copay.js";
import { rehearseAiApply } from "./steps-rehearsal.js";
import {
  configureActions,
  connectIntegrations,
  expectManualBenefit,
  manageEquipment,
  overrideBenefit,
} from "./steps-hr.js";
import {
  addPerson,
  addTeamMember,
  completeChecklist,
  ensureOrg,
  ensureResume,
  listJobs,
  openCareer,
  readBenefit,
  saveResume,
  savePreferences,
  setBenefitPolicy,
  setCareerSponsoredUntil,
  signInCollaborator,
  subscribeCompany,
  submitExitSurvey,
  upgradeCareerPro,
  type Admin,
  type OrgSpec,
  type PersonSpec,
  type Role,
} from "./steps.js";

type TeamSpec = { name: string; email: string; role: Role };

export const orgs = [
  {
    org: {
      orgName: "Aurora Cosméticos",
      slug: "aurora-cosmeticos",
      adminName: "Beatriz Castro",
      adminEmail: "beatriz.castro@aurora.example.com",
    },
    plan: "gold",
    team: [
      { name: "Camila Rocha", email: "camila.rocha@aurora.example.com", role: "rh" },
      { name: "Diego Alves", email: "diego.alves@aurora.example.com", role: "gestor" },
      { name: "Mariana Santos", email: "mariana.santos@aurora.example.com", role: "visualizador" },
    ],
  },
  {
    org: {
      orgName: "Horizonte Logística",
      slug: "horizonte-logistica",
      adminName: "Rafaela Nunes",
      adminEmail: "rafaela.nunes@horizonte.example.com",
    },
    plan: "silver",
    team: [{ name: "Lucas Pereira", email: "lucas.pereira@horizonte.example.com", role: "rh" }],
  },
  {
    org: {
      orgName: "Vale Verde Agro",
      slug: "vale-verde-agro",
      adminName: "Otávio Prado",
      adminEmail: "otavio.prado@valeverde.example.com",
    },
    plan: "platinum",
    team: [
      { name: "Juliana Ferreira", email: "juliana.ferreira@valeverde.example.com", role: "rh" },
      { name: "Roberto Souza", email: "roberto.souza@valeverde.example.com", role: "visualizador" },
    ],
  },
] satisfies { org: OrgSpec; plan: string; team: TeamSpec[] }[];

const aurora = orgs[0];

export const people = {
  marina: {
    name: "Marina Lopes",
    role: "Analista de marketing",
    department: "Marketing",
    email: "marina.colaboradora@aurora.example.com",
    deadlineInDays: 14,
  },
  rafael: {
    name: "Rafael Mendes",
    role: "Engenheiro de software",
    department: "Tecnologia",
    email: "rafael.colaborador@aurora.example.com",
    deadlineInDays: 21,
  },
  bianca: {
    name: "Bianca Souza",
    role: "Coordenadora de operações",
    department: "Operações",
    email: "bianca.colaboradora@aurora.example.com",
    deadlineInDays: 30,
  },
  helena: {
    name: "Helena Pires",
    role: "Analista de CRM",
    department: "Marketing",
    email: "helena.colaboradora@aurora.example.com",
    deadlineInDays: 10,
  },
  nina: {
    name: "Nina Castro",
    role: "Gerente de produto",
    department: "Produto",
    email: "nina.colaboradora@aurora.example.com",
    deadlineInDays: 12,
  },
  gustavo: {
    name: "Gustavo Ribeiro",
    role: "Executivo de contas",
    department: "Comercial",
    email: "gustavo.colaborador@aurora.example.com",
    deadlineInDays: 7,
  },
} satisfies Record<string, PersonSpec>;

export const helenaResume = {
  headline: { text: "Analista de CRM e Marketing Digital" },
  summary: {
    text: "Seis anos em marketing de relacionamento, com régua de e-mail, segmentação de base e acompanhamento de recompra.",
  },
  experiences: [
    {
      company: "Aurora Cosméticos",
      role: "Analista de CRM",
      start: "2021-03",
      end: null,
      bullets: [
        { text: "Estruturei a régua de relacionamento por e-mail, elevando a recompra em 18%." },
        {
          text: "Segmentei a base de clientes no HubSpot e acompanhei os resultados por campanha.",
        },
      ],
    },
    {
      company: "Loja Casa Clara",
      role: "Assistente de marketing",
      start: "2019-02",
      end: "2021-02",
      bullets: [{ text: "Planejei campanhas de mídia paga e redes sociais com orçamento mensal." }],
    },
  ],
  education: [
    {
      institution: "Universidade Federal de Minas Gerais",
      degree: "Bacharelado em Comunicação Social",
      start: "2015",
      end: "2018",
    },
  ],
  skills: [
    { name: "CRM" },
    { name: "E-mail marketing" },
    { name: "HubSpot" },
    { name: "Mídia paga" },
    { name: "Excel" },
  ],
  languages: [
    { name: "Português", level: "Nativo" },
    { name: "Inglês", level: "Avançado" },
  ],
  contact: {
    email: people.helena.email,
    phone: "+55 11 91234-5678",
    city: "São Paulo",
    links: ["https://www.linkedin.com/in/helena-pires-exemplo"],
  },
};

export const helenaPreferences = {
  mode: "hybrid",
  hybridThreshold: 75,
  targetTitles: ["Analista de CRM", "Analista de Marketing Digital"],
  jobPreferences: {
    workModels: ["remote", "hybrid"],
    locations: [{ city: null, state: "SP" }],
    relocate: false,
    salaryFloorCents: null,
    seniorities: [],
    excludedCompanies: [],
  },
  profileFields: {
    city: { value: "São Paulo", share: true },
    linkedin: { value: "https://www.linkedin.com/in/helena-pires-exemplo", share: true },
  },
};

async function seedOrgs(ctx: Context, specs: typeof orgs) {
  const admins = [];

  for (const spec of specs) {
    const admin = await ensureOrg(ctx, spec.org);

    for (const member of spec.team) await addTeamMember(ctx, admin, member);

    await subscribeCompany(ctx, admin, spec.plan);

    admins.push(admin);
  }

  return admins;
}

async function auroraAdmin(ctx: Context) {
  await ctx.seedCatalog();

  const admin = await ensureOrg(ctx, aurora.org);

  for (const member of aurora.team) await addTeamMember(ctx, admin, member);

  return admin;
}

async function orgsScenario(ctx: Context) {
  await ctx.seedCatalog();
  await seedOrgs(ctx, orgs);
}

const benefitPolicy = {
  defaultPlanSlug: "silver",
  durationMonths: 6,
  rules: [
    {
      id: "tecnologia-gold",
      field: "department",
      operator: "equals",
      value: "Tecnologia",
      planSlug: "gold",
    },
  ],
} as const;

async function addPersonScenario(ctx: Context) {
  const admin = await auroraAdmin(ctx);

  await setBenefitPolicy(ctx, admin, { ...benefitPolicy, rules: [...benefitPolicy.rules] });

  for (const spec of [people.marina, people.rafael]) {
    const person = await addPerson(ctx, admin, spec);
    const collaborator = await signInCollaborator(ctx, person);

    await openCareer(ctx, collaborator);
    await readBenefit(ctx, admin, person.name);
  }
}

async function benefitCopayScenario(ctx: Context) {
  const admin = await auroraAdmin(ctx);

  await setBenefitPolicy(ctx, admin, { ...benefitPolicy, rules: [...benefitPolicy.rules] });

  const person = await addPerson(ctx, admin, people.marina);
  const collaborator = await signInCollaborator(ctx, person);
  const profileId = await openCareer(ctx, collaborator);

  await readBenefit(ctx, admin, person.name);
  await payBenefitCopay(ctx, collaborator, profileId);
}

async function companyPaymentScenario(ctx: Context) {
  await ctx.seedCatalog();

  await seedOrgs(ctx, [orgs[1]]);
}

async function careerScenario(ctx: Context) {
  const admin = await auroraAdmin(ctx);
  const person = await addPerson(ctx, admin, people.helena);
  const collaborator = await signInCollaborator(ctx, person);
  const profileId = await openCareer(ctx, collaborator);

  await saveResume(ctx, collaborator, helenaResume);
  await savePreferences(ctx, collaborator, helenaPreferences);
  await improveWithAi(ctx, collaborator);
  await listJobs(ctx, collaborator);
  await setCareerSponsoredUntil(ctx, admin, person, addDays(ctx.today(), -10));
  await upgradeCareerPro(ctx, collaborator, profileId);
  await draftAiApply(ctx, collaborator, "Analista de Marketing Pleno");
}

async function helenaCollaborator(ctx: Context, admin: Admin) {
  const person = await addPerson(ctx, admin, people.helena);
  const collaborator = await signInCollaborator(ctx, person);

  await openCareer(ctx, collaborator);

  return collaborator;
}

async function applicationsScenario(ctx: Context) {
  const admin = await auroraAdmin(ctx);
  const collaborator = await helenaCollaborator(ctx, admin);

  await ensureResume(ctx, collaborator, helenaResume);
  await recordApplications(ctx, collaborator);
}

async function answersScenario(ctx: Context) {
  const admin = await auroraAdmin(ctx);
  const collaborator = await helenaCollaborator(ctx, admin);

  await saveAnswers(ctx, collaborator);
  await rejectJobs(ctx, collaborator);
}

async function aiApplyRehearsalScenario(ctx: Context) {
  const admin = await auroraAdmin(ctx);
  const person = await addPerson(ctx, admin, people.helena);
  const collaborator = await signInCollaborator(ctx, person);
  const profileId = await openCareer(ctx, collaborator);

  await ensureResume(ctx, collaborator, helenaResume);
  await upgradeCareerPro(ctx, collaborator, profileId);
  await rehearseAiApply(ctx, collaborator);
}

async function benefitsManualScenario(ctx: Context) {
  const admin = await auroraAdmin(ctx);
  const policy = { ...benefitPolicy, rules: [...benefitPolicy.rules] };

  await setBenefitPolicy(ctx, admin, policy);

  const person = await addPerson(ctx, admin, people.marina);
  const collaborator = await signInCollaborator(ctx, person);

  await openCareer(ctx, collaborator);
  await overrideBenefit(ctx, admin, person.name, "platinum");
  await setBenefitPolicy(ctx, admin, { ...policy, defaultPlanSlug: "gold" });
  await openCareer(ctx, collaborator);
  await expectManualBenefit(ctx, admin, person.name);
  await setBenefitPolicy(ctx, admin, policy);
}

async function equipmentScenario(ctx: Context) {
  const admin = await auroraAdmin(ctx);
  const person = await addPerson(ctx, admin, people.nina);

  await manageEquipment(ctx, admin, person);
}

async function integrationsScenario(ctx: Context) {
  const admin = await auroraAdmin(ctx);

  await connectIntegrations(ctx, admin);
}

async function checklistActionsScenario(ctx: Context) {
  const admin = await auroraAdmin(ctx);
  const person = await addPerson(ctx, admin, people.nina);
  const receiver = await ctx.startReceiver();

  try {
    await configureActions(ctx, admin, person, receiver);
  } finally {
    await receiver.close();
  }
}

async function offboardingScenario(ctx: Context) {
  const admin = await auroraAdmin(ctx);
  const person = await addPerson(ctx, admin, people.gustavo);

  await completeChecklist(ctx, admin, person);
  await submitExitSurvey(ctx, admin, person);
}

async function allScenario(ctx: Context) {
  await orgsScenario(ctx);
  await addPersonScenario(ctx);
  await benefitCopayScenario(ctx);
  await companyPaymentScenario(ctx);
  await benefitsManualScenario(ctx);
  await careerScenario(ctx);
  await applicationsScenario(ctx);
  await answersScenario(ctx);
  await aiApplyRehearsalScenario(ctx);
  await equipmentScenario(ctx);
  await integrationsScenario(ctx);
  await checklistActionsScenario(ctx);
  await offboardingScenario(ctx);
}

export const scenarios = {
  orgs: orgsScenario,
  "add-person": addPersonScenario,
  "company-payment": companyPaymentScenario,
  career: careerScenario,
  offboarding: offboardingScenario,
  applications: applicationsScenario,
  answers: answersScenario,
  "benefits-manual": benefitsManualScenario,
  "benefit-copay": benefitCopayScenario,
  "ai-apply-rehearsal": aiApplyRehearsalScenario,
  equipment: equipmentScenario,
  integrations: integrationsScenario,
  "checklist-actions": checklistActionsScenario,
  all: allScenario,
} satisfies Record<ScenarioName, (ctx: Context) => Promise<void>>;
