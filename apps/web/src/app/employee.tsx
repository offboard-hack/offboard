import Briefcase01Icon from "@hugeicons/core-free-icons/Briefcase01Icon";
import Calendar01Icon from "@hugeicons/core-free-icons/Calendar01Icon";
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import Contact01Icon from "@hugeicons/core-free-icons/Contact01Icon";
import File02Icon from "@hugeicons/core-free-icons/File02Icon";
import FirstAidKitIcon from "@hugeicons/core-free-icons/FirstAidKitIcon";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import Mail01Icon from "@hugeicons/core-free-icons/Mail01Icon";
import Package01Icon from "@hugeicons/core-free-icons/Package01Icon";
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
import UserCircleIcon from "@hugeicons/core-free-icons/UserCircleIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { employeeDate } from "@offboard/employee";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link, type ErrorComponentProps } from "@tanstack/react-router";
import { useCallback, type ReactNode } from "react";
import { applicationsSummaryQuery } from "@/entities/career";
import {
  type EmployeeAccount,
  employeeJourneyQuery,
  employeeStateQuery,
} from "@/entities/employee";
import { EmployeeAgenda } from "@/features/employee/agenda-calendar";
import { Career } from "@/features/employee/career";
import { Preferences } from "@/features/employee/career/preferences";
import { ResumeCareer } from "@/features/employee/career/resume";
import {
  DepartureOverview,
  EmployeeChecklist,
  Equipment,
  Exam,
  Feedback,
  Handoff,
  Termination,
} from "@/features/employee/departure";
import { Privacy, PrivacyNotice, Profile } from "@/features/employee/privacy";
import { subscribeToSessionChanges } from "@/shared/lib/session-change";
import { ListPage, type ListMetric } from "@/shared/ui/list-page";
import { ListPendingPage } from "@/shared/ui/list-pending-page";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/shadcn/breadcrumb";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuSkeleton,
} from "@/shared/ui/shadcn/sidebar";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { RouteError } from "./portal";
import type { Route as EmployeeRoute } from "./routes/colaborador";
import { PortalLayout, PortalSidebarLink } from "./shell";
import { PortalSignOut, SidebarUser, SidebarUserItem } from "./sidebar-user";

const route = getRouteApi("/colaborador");
const workspaceName = "Área do colaborador";
const sidebarDescription = "Navegação da área do colaborador.";

type EmployeeScreen = (typeof EmployeeRoute)["types"]["fullSearchSchema"]["tela"];

const titles = {
  hoje: "Hoje",
  saida: "Minha saída",
  carreira: "Carreira",
  curriculo: "Currículo",
  preferencias: "Preferências",
  perfil: "Seu perfil",
  privacidade: "Privacidade",
  passagem: "Passar seu trabalho",
  equipamentos: "Devolver equipamentos",
  exame: "Exame demissional",
  rescisao: "Termo de rescisão",
  feedback: "Avaliar minha saída",
} satisfies Record<EmployeeScreen, string>;

const navigation = [
  {
    label: "Jornada",
    items: [
      { id: "hoje", icon: Home01Icon, label: "Hoje" },
      { id: "saida", icon: CheckListIcon, label: "Saída" },
    ],
  },
  {
    label: "Transição",
    items: [
      { id: "carreira", icon: Briefcase01Icon, label: "Carreira" },
      { id: "curriculo", icon: File02Icon, label: "Currículo" },
      { id: "preferencias", icon: Settings02Icon, label: "Preferências" },
    ],
  },
] as const;

function parentScreen(screen: EmployeeScreen) {
  switch (screen) {
    case "passagem":
    case "equipamentos":
    case "exame":
    case "rescisao":
    case "feedback":
      return "saida";
    case "privacidade":
      return "perfil";
    default:
      return screen;
  }
}

export function EmployeePage() {
  const { account } = route.useRouteContext();
  const { tela: screen } = route.useSearch();

  const { data: consent, refetch: recheckAccess } = useSuspenseQuery(
    employeeStateQuery(account, "consent"),
  );

  const { data: journey } = useSuspenseQuery(employeeJourneyQuery(account));

  const onMainMount = useCallback(
    () =>
      subscribeToSessionChanges(() => {
        void recheckAccess({ cancelRefetch: false });
      }),
    [recheckAccess],
  );

  if (consent.key !== "consent") throw new Error("Não foi possível abrir suas escolhas.");

  return (
    <PortalLayout
      key={account.grantId}
      fullWidth
      focusOnSearch
      onMainMount={onMainMount}
      workspaceName={journey.plan.company ?? workspaceName}
      sidebarDescription={sidebarDescription}
      navigation={<EmployeeNavigation screen={screen} />}
      accountMenu={
        <SidebarUser name={account.name} label="Colaborador" signInPath="/colaborador/entrar">
          <SidebarUserItem
            link={<Link to="/colaborador" search={{ tela: "perfil" }} />}
            icon={UserCircleIcon}
          >
            Perfil
          </SidebarUserItem>
        </SidebarUser>
      }
    >
      <div className="flex min-h-[calc(100svh-3rem)] flex-col">
        {screen === "privacidade" ? (
          <EmployeeScreenPage screen={screen}>
            <Privacy account={account} state={consent} />
          </EmployeeScreenPage>
        ) : (
          <EmployeeContent screen={screen} account={account} />
        )}
        {!consent.value.accepted && (
          <PrivacyNotice account={account} state={consent} visible={screen !== "privacidade"} />
        )}
      </div>
    </PortalLayout>
  );
}

export function EmployeePending() {
  return (
    <PortalLayout
      fullWidth
      workspaceName={workspaceName}
      sidebarDescription={sidebarDescription}
      navigation={navigation.map(({ label, items }) => (
        <SidebarGroup key={label} aria-hidden="true">
          <SidebarGroupLabel>{label}</SidebarGroupLabel>
          <SidebarMenu>
            {items.map(({ id }) => (
              <li key={id}>
                <SidebarMenuSkeleton showIcon />
              </li>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
      accountMenu={null}
    >
      <ListPendingPage title="Minha jornada" breadcrumb={null}>
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-52 w-full rounded-2xl" />
      </ListPendingPage>
    </PortalLayout>
  );
}

export function EmployeeRouteError({ reset }: ErrorComponentProps) {
  return (
    <PortalLayout
      fullWidth={false}
      workspaceName={workspaceName}
      sidebarDescription={sidebarDescription}
      navigation={<EmployeeNavigation />}
      accountMenu={null}
    >
      <RouteError
        reset={reset}
        title="Não foi possível abrir sua jornada"
        description="Tente carregar novamente para voltar à jornada ou saia desta sessão."
        action={<PortalSignOut signInPath="/colaborador/entrar" />}
        restoreFocus
      />
    </PortalLayout>
  );
}

function EmployeeNavigation({ screen }: { screen?: EmployeeScreen }) {
  const active = screen && parentScreen(screen);

  return (
    <nav aria-label="Minha jornada">
      {navigation.map(({ label, items }) => (
        <SidebarGroup key={label} role="group" aria-label={label}>
          <SidebarGroupLabel>{label}</SidebarGroupLabel>
          <SidebarMenu>
            {items.map(({ id, icon, label: itemLabel }) => (
              <PortalSidebarLink
                key={id}
                isActive={active === id}
                label={itemLabel}
                render={
                  <Link
                    to="/colaborador"
                    search={{ tela: id }}
                    activeOptions={{ exact: true, includeSearch: true }}
                    aria-current={screen === id ? "page" : active === id ? "location" : undefined}
                  />
                }
              >
                <HugeiconsIcon icon={icon} aria-hidden="true" />
              </PortalSidebarLink>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </nav>
  );
}

function EmployeeScreenPage({
  screen,
  metrics,
  children,
}: {
  screen: EmployeeScreen;
  metrics?: ListMetric[];
  children: ReactNode;
}) {
  const parent = parentScreen(screen);
  const title = titles[screen];

  return (
    <ListPage
      title={title}
      metrics={metrics}
      breadcrumb={
        <Breadcrumb aria-label="Localização">
          <BreadcrumbList>
            {screen !== "hoje" ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink render={<Link to="/colaborador" search={{ tela: "hoje" }} />}>
                    Hoje
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </>
            ) : null}
            {parent !== screen ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink render={<Link to="/colaborador" search={{ tela: parent }} />}>
                    {titles[parent]}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </>
            ) : null}
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      {children}
    </ListPage>
  );
}

function EmployeeContent({
  screen,
  account,
}: {
  screen: EmployeeScreen;
  account: EmployeeAccount;
}) {
  switch (parentScreen(screen)) {
    case "perfil":
      return (
        <EmployeeScreenPage screen={screen}>
          <Profile account={account} signOut={<PortalSignOut signInPath="/colaborador/entrar" />} />
        </EmployeeScreenPage>
      );
    case "carreira":
    case "curriculo":
      return <CareerContent account={account} screen={screen} />;
    case "preferencias":
      return <PreferencesContent account={account} />;
    default:
      return <DepartureContent account={account} screen={screen} />;
  }
}

function DepartureContent({
  account,
  screen,
}: {
  account: EmployeeAccount;
  screen: EmployeeScreen;
}) {
  const { data: journey } = useSuspenseQuery(employeeJourneyQuery(account));
  const { data: state } = useSuspenseQuery(employeeStateQuery(account, "departure-v1"));

  if (state.key !== "departure-v1") throw new Error("Não foi possível abrir a saída.");

  const dateFormat = { day: "2-digit", month: "2-digit" } as const;

  const reviewed = journey.plan.handoff.filter(({ id }) =>
    state.value.handoffCompleted.includes(id),
  ).length;

  const metrics: ListMetric[] = [
    {
      label: "Prazo da rescisão",
      icon: Calendar01Icon,
      tone: "primary",
      value: employeeDate(journey.deadline, dateFormat),
    },
    {
      label: "Itens da passagem",
      icon: CheckListIcon,
      tone: "primary",
      value: `${reviewed}/${journey.plan.handoff.length}`,
    },
    {
      label: "Bens",
      icon: Package01Icon,
      tone: "primary",
      value: journey.equipment.length,
    },
    {
      label: "Exame demissional",
      icon: FirstAidKitIcon,
      tone: state.value.examAttended ? "success" : "primary",
      value: journey.plan.exam ? employeeDate(journey.plan.exam.day, dateFormat) : "A informar",
    },
  ];

  let content: ReactNode;

  switch (screen) {
    case "passagem":
      content = <Handoff account={account} journey={journey} state={state} />;
      break;
    case "equipamentos":
      content = <Equipment account={account} journey={journey} state={state} />;
      break;
    case "exame":
      content = <Exam account={account} journey={journey} state={state} />;
      break;
    case "rescisao":
      content = <Termination journey={journey} />;
      break;
    case "feedback":
      content = <Feedback account={account} state={state} />;
      break;
    default:
      content = (
        <>
          {screen === "hoje" ? <EmployeeAgenda account={account} journey={journey} /> : null}
          <EmployeeChecklist account={account} journey={journey} />
          <DepartureOverview journey={journey} state={state} home={screen === "hoje"} />
        </>
      );
  }

  return (
    <EmployeeScreenPage screen={screen} metrics={screen === "hoje" ? metrics : undefined}>
      {content}
    </EmployeeScreenPage>
  );
}

function PreferencesContent({ account }: { account: EmployeeAccount }) {
  const { secao } = route.useSearch();

  return (
    <EmployeeScreenPage screen="preferencias">
      <Preferences account={account} section={secao} />
    </EmployeeScreenPage>
  );
}

function CareerContent({ account, screen }: { account: EmployeeAccount; screen: EmployeeScreen }) {
  const { carreira, plano, copay } = route.useSearch();
  const tracking = screen === "carreira" && carreira === "candidaturas";
  const { data: summary } = useQuery({ ...applicationsSummaryQuery(account), enabled: tracking });

  const metrics: ListMetric[] | undefined =
    tracking && summary
      ? [
          { label: "Enviadas", icon: Briefcase01Icon, tone: "primary", value: summary.sent },
          { label: "Respostas", icon: Mail01Icon, tone: "primary", value: summary.responded },
          {
            label: "Entrevistas",
            icon: Calendar01Icon,
            tone: "primary",
            value: summary.interviews,
          },
          { label: "Ofertas", icon: Contact01Icon, tone: "success", value: summary.offers },
        ]
      : undefined;

  return (
    <EmployeeScreenPage screen={screen} metrics={metrics}>
      {screen === "curriculo" ? (
        <ResumeCareer account={account} />
      ) : (
        <Career
          account={account}
          view={carreira}
          paid={plano === "ok"}
          copayPaid={copay === "ok"}
        />
      )}
    </EmployeeScreenPage>
  );
}
