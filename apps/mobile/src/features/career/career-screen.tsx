import { useEmployeeJourney } from "../../shared/employee-journey";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Briefcase01Icon from "@hugeicons/core-free-icons/Briefcase01Icon";
import Calendar03Icon from "@hugeicons/core-free-icons/Calendar03Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon";
import { router, useLocalSearchParams } from "expo-router";
import { type ComponentRef, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  type ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { SelectionControl } from "../../shared/selection-control";
import { colors, fonts, radii } from "../../shared/theme";
import { Button, Card, Icon, Screen, Text } from "../../shared/ui";
import { CareerDialog, Pill, StorageNotice } from "./components";
import { useCareerData } from "./data";
import {
  type Application,
  type Job,
  type Resume,
  type StatusFilter,
  applicationCounts,
  applicationStatusLabel,
  applyForJob,
  demoName,
  displayCalendarDay,
  displayDate,
  jobFit,
  jobs as demoJobs,
  localDate,
  matchesStatus,
  shiftDate,
  sourceLabels,
  statusFilters,
  weekRange,
  weekStart,
} from "./model";

const jobFilters = [
  { id: "all", label: "Todas" },
  { id: "hybrid", label: "Híbrido" },
  { id: "remote", label: "Remoto" },
  { id: "cohort", label: "Da turma" },
] as const;

const tabs = [
  { id: "vagas", label: "Vagas" },
  { id: "candidaturas", label: "Candidaturas" },
] as const;

type JobFilter = (typeof jobFilters)[number]["id"];

type CareerDialogContent =
  | { kind: "job"; job: Job }
  | { kind: "application"; application: Application };

function CompanyMark({ color, company }: { color: string; company: string }) {
  return (
    <View style={[styles.companyMark, { backgroundColor: color }]} aria-hidden>
      <Text variant="label" maxFontSizeMultiplier={1.4} style={{ color: colors.background }}>
        {company.charAt(0)}
      </Text>
    </View>
  );
}

function JobCard({
  job,
  base,
  application,
  open,
  disabled,
}: {
  job: Job;
  base: Resume;
  application: Application | undefined;
  open: () => void;
  disabled: boolean;
}) {
  const location = job.mode === "hybrid" ? `Híbrido, ${job.location}` : "Remoto";
  const match = jobFit(job, base).score;

  return (
    <Card style={styles.jobCard}>
      <View style={styles.row}>
        <CompanyMark color={job.color} company={job.company} />
        <View style={styles.rowText}>
          <Text variant="label">{job.title}</Text>
          <Text variant="caption" style={styles.muted}>
            {job.company} · {location}
          </Text>
        </View>
      </View>
      <View style={styles.pills}>
        <Pill label={`${match}% de compatibilidade`} tone="accent" />
        <Pill label={job.salary} />
        <Pill label={sourceLabels[job.source]} />
      </View>
      <Button
        label={application ? "Ver candidatura" : "Adaptar e candidatar"}
        accessibilityLabel={
          application
            ? `Ver candidatura a ${job.title} na ${job.company}`
            : `Adaptar e candidatar a ${job.title} na ${job.company}`
        }
        variant={application ? "outline" : "primary"}
        disabled={disabled}
        onPress={open}
      />
    </Card>
  );
}

function ApplicationCard({ application, open }: { application: Application; open: () => void }) {
  const { company, title, color, status } = application;
  const label = applicationStatusLabel(application);

  const tone = status.kind === "sent" ? "muted" : status.kind === "offer" ? "success" : "accent";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${company}, ${label}`}
      onPress={open}
      style={({ pressed }) => pressed && { opacity: 0.72 }}
    >
      <Card style={styles.applicationCard}>
        <View style={styles.row}>
          <CompanyMark company={company} color={color} />
          <View style={styles.rowText}>
            <Text variant="label">{title}</Text>
            <Text variant="caption" style={styles.muted}>
              {company} · {displayDate(application.appliedAt)}
            </Text>
          </View>
          <Icon name={ArrowRight01Icon} size={17} color={colors.mutedForeground} />
        </View>
        <Pill label={label} tone={tone} />
      </Card>
    </Pressable>
  );
}

const weekDays = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function CalendarNav({
  day,
  unit,
  select,
}: {
  day: string;
  unit: "day" | "week";
  select: (date: string) => void;
}) {
  const step = unit === "day" ? 1 : 7;

  return (
    <View style={styles.weekActions}>
      <Pressable
        style={({ pressed }) => [styles.smallControl, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={unit === "day" ? "Dia anterior" : "Semana anterior"}
        onPress={() => select(shiftDate(day, -step))}
      >
        <Icon name={ArrowLeft01Icon} size={16} color={colors.primary} />
      </Pressable>
      <Text
        variant="label"
        accessibilityLabel={unit === "day" ? displayDate(day) : undefined}
        accessibilityLiveRegion="polite"
        style={styles.weekRange}
      >
        {unit === "day" ? displayCalendarDay(day) : weekRange(weekStart(day))}
      </Text>
      <Pressable
        style={({ pressed }) => [styles.smallControl, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={unit === "day" ? "Próximo dia" : "Próxima semana"}
        onPress={() => select(shiftDate(day, step))}
      >
        <Icon name={ArrowRight01Icon} size={16} color={colors.primary} />
      </Pressable>
    </View>
  );
}

function Interviews({
  applications,
  open,
}: {
  applications: Application[];
  open: (application: Application) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const useAgenda = width < 384 || fontScale > 1.1;

  const interviews = applications.flatMap((application) =>
    application.status.kind === "interview"
      ? [{ application, interview: application.status.interview }]
      : [],
  );

  const nextInterview = interviews
    .map(({ interview }) => interview.date)
    .sort()
    .find((date) => date >= localDate());

  const firstInterview = interviews.map(({ interview }) => interview.date).sort()[0];

  const [selectedDay, setSelectedDay] = useState(
    () => nextInterview ?? firstInterview ?? localDate(),
  );

  const [showWeek, setShowWeek] = useState(false);
  const weekToggle = useRef<ComponentRef<typeof Pressable>>(null);

  const start = weekStart(selectedDay);
  const dailyInterviews = interviews.filter(({ interview }) => interview.date === selectedDay);

  function chooseDate(date: string) {
    setSelectedDay(date);

    if (!useAgenda) return;

    const toggle = weekToggle.current;

    if (toggle) {
      if (Platform.OS === "web") toggle.focus();
      else AccessibilityInfo.sendAccessibilityEvent(toggle, "focus");
    }

    setShowWeek(false);
  }

  return (
    <Card style={styles.calendar}>
      <View style={styles.calendarHeading}>
        <Text variant="heading" style={styles.sectionTitle}>
          Entrevistas
        </Text>
        <Pressable
          style={({ pressed }) => [styles.todayControl, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Ir para hoje"
          onPress={() => setSelectedDay(localDate())}
        >
          <Text variant="caption" style={styles.todayLabel}>
            Hoje
          </Text>
        </Pressable>
      </View>
      <CalendarNav
        day={selectedDay}
        unit={useAgenda && !showWeek ? "day" : "week"}
        select={setSelectedDay}
      />
      {useAgenda ? (
        <Pressable
          ref={weekToggle}
          accessibilityRole="button"
          aria-expanded={showWeek}
          onPress={() => setShowWeek(!showWeek)}
          style={({ pressed }) => [styles.weekToggle, pressed && styles.pressed]}
        >
          <Icon name={Calendar03Icon} size={19} />
          <Text variant="label" style={styles.weekToggleText}>
            {showWeek ? "Ocultar dias da semana" : "Ver dias da semana"}
          </Text>
        </Pressable>
      ) : null}
      {!useAgenda || showWeek ? (
        <View style={useAgenda ? styles.daysList : styles.days}>
          {weekDays.map((day, index) => {
            const date = shiftDate(start, index);
            const selected = date === selectedDay;
            const hasInterviews = interviews.some(({ interview }) => interview.date === date);
            const color = selected ? colors.primaryForeground : colors.foreground;

            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                aria-pressed={Platform.OS === "web" ? selected : undefined}
                accessibilityState={Platform.OS === "web" ? undefined : { selected }}
                accessibilityLabel={`${displayDate(date)}${hasInterviews ? ", com entrevista" : ""}`}
                onPress={() => chooseDate(date)}
                style={({ pressed }) => [
                  styles.day,
                  useAgenda && styles.dayListItem,
                  selected && styles.daySelected,
                  pressed && styles.pressed,
                ]}
              >
                {useAgenda ? (
                  <Text variant="caption" style={[styles.dayListLabel, { color }]}>
                    {displayDate(date)}
                  </Text>
                ) : (
                  <>
                    <Text variant="caption" style={{ color }}>
                      {day}
                    </Text>
                    <Text variant="label" style={{ color }}>
                      {Number(date.slice(-2))}
                    </Text>
                  </>
                )}
                <View
                  style={[
                    styles.dot,
                    hasInterviews && {
                      backgroundColor: selected ? colors.background : colors.primary,
                    },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {dailyInterviews.length === 0 ? (
        <View style={[styles.event, styles.emptyEvent]}>
          <Icon name={Calendar03Icon} size={18} color={colors.mutedForeground} />
          <Text variant="muted">Nenhuma entrevista neste dia.</Text>
        </View>
      ) : (
        dailyInterviews.map(({ application, interview }) => (
          <Pressable
            key={application.id}
            accessibilityRole="button"
            accessibilityLabel={`Ver ${interview.title}, às ${interview.time}`}
            onPress={() => open(application)}
            style={({ pressed }) => [
              styles.event,
              useAgenda && styles.eventStacked,
              pressed && styles.pressed,
            ]}
          >
            <Text variant="label" style={{ color: colors.primary }}>
              {interview.time}
            </Text>
            <View style={useAgenda ? styles.eventDetails : styles.rowText}>
              <Text variant="label">{interview.title}</Text>
              <Text variant="caption" style={styles.muted}>
                {application.title} · {interview.format}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </Card>
  );
}

export function CareerScreen({ name = demoName }: { name?: string }) {
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab = params.tab === "candidaturas" ? "candidaturas" : "vagas";
  const [data, update, storage] = useCareerData();
  const employeeJourney = useEmployeeJourney();
  const jobs = employeeJourney?.plan.jobs ?? demoJobs;
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dialog, setDialog] = useState<CareerDialogContent | null>(null);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const counts = applicationCounts(data.applications);
  const { width, fontScale } = useWindowDimensions();
  const stackedControls = width < 360 || fontScale > 1.1;
  const stackedTabs = fontScale >= 1.4;

  const visibleJobs = jobs
    .filter(
      (job) =>
        jobFilter === "all" ||
        job.mode === jobFilter ||
        (jobFilter === "cohort" && job.source === "cohort"),
    )
    .sort((a, b) => jobFit(b, data.base).score - jobFit(a, data.base).score);

  const visibleApplications = data.applications.filter((application) =>
    matchesStatus(application, statusFilter),
  );

  function openApplication(application: Application) {
    setDialog({ kind: "application", application });
  }

  function changeTab(next: (typeof tabs)[number]["id"]) {
    if (next === tab) return;

    scroll.current?.scrollTo({ y: 0, animated: false });
    router.setParams({ tab: next });
  }

  function closeDialog() {
    if (submitting) storage.discardFailedWrite();

    setDialog(null);
    setSubmitting(false);
  }

  function confirmRegistration(job: Job) {
    closeDialog();
    setStatusFilter("all");
    setNotice(
      `Candidatura a ${job.company} registrada neste app. O currículo adaptado está em Currículo.`,
    );
    changeTab("candidaturas");
  }

  async function register(job: Job) {
    setSubmitting(true);

    const registered = await update(
      (previous) => applyForJob(previous, { job, date: localDate(), name }),
      { errorMessage: "Não foi possível registrar a candidatura." },
    );

    if (registered) confirmRegistration(job);
  }

  async function retryRegistration(job: Job) {
    if (await storage.retry()) confirmRegistration(job);
  }

  return (
    <Screen scrollRef={scroll}>
      <Text variant="title">Carreira</Text>
      <View
        accessibilityRole="tablist"
        accessibilityLabel="Carreira"
        style={[styles.tabs, stackedTabs && styles.tabsStacked]}
      >
        {tabs.map(({ id, label }) => (
          <SelectionControl
            key={id}
            nativeID={`career-tab-${id}`}
            role="tab"
            selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            aria-controls={`career-panel-${id}`}
            onPress={() => changeTab(id)}
            style={({ pressed }) => [
              styles.tab,
              stackedTabs && styles.tabStacked,
              tab === id && styles.tabActive,
              pressed && styles.pressed,
            ]}
          >
            <Text variant="label" style={tab !== id && styles.muted}>
              {label}
              {id === "candidaturas" ? ` · ${counts.all}` : ""}
            </Text>
          </SelectionControl>
        ))}
      </View>
      {tabs.map(({ id }) => (
        <View
          key={id}
          nativeID={`career-panel-${id}`}
          role={Platform.OS === "web" ? "tabpanel" : undefined}
          aria-labelledby={Platform.OS === "web" ? `career-tab-${id}` : undefined}
          style={id === tab ? styles.list : styles.hidden}
        >
          {id === tab ? (
            <>
              {!submitting ? (
                <StorageNotice
                  saving={storage.saving}
                  error={storage.error}
                  retry={storage.retry}
                  discard={storage.readFailed ? undefined : storage.discardFailedWrite}
                />
              ) : null}
              {storage.loading ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text variant="muted">Carregando sua carreira…</Text>
                </View>
              ) : storage.readFailed ? null : tab === "vagas" ? (
                <View style={styles.list}>
                  <View role="group" style={styles.filters} accessibilityLabel="Filtrar vagas">
                    {jobFilters.map(({ id, label }) => (
                      <Pressable
                        key={id}
                        accessibilityRole="button"
                        aria-pressed={Platform.OS === "web" ? jobFilter === id : undefined}
                        accessibilityState={
                          Platform.OS === "web" ? undefined : { selected: jobFilter === id }
                        }
                        onPress={() => setJobFilter(id)}
                        style={({ pressed }) => [
                          styles.filter,
                          stackedControls && styles.stackedControl,
                          jobFilter === id && styles.filterSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text
                          variant="label"
                          style={[styles.filterLabel, jobFilter === id && styles.white]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {visibleJobs.map((job) => {
                    const application = data.applications.find((item) => item.jobId === job.id);

                    return (
                      <JobCard
                        key={job.id}
                        job={job}
                        base={data.base}
                        application={application}
                        disabled={Boolean((storage.pending || storage.error) && !application)}
                        open={() =>
                          application
                            ? openApplication(application)
                            : setDialog({ kind: "job", job })
                        }
                      />
                    );
                  })}
                </View>
              ) : (
                <View style={styles.list}>
                  {notice && !storage.pending && !storage.error ? (
                    <View style={styles.feedback}>
                      <Icon name={CheckmarkCircle02Icon} size={20} color={colors.success} />
                      <Text
                        accessibilityLiveRegion="polite"
                        variant="body"
                        style={{ color: colors.success, flex: 1 }}
                      >
                        {notice}
                      </Text>
                    </View>
                  ) : null}
                  <Interviews applications={data.applications} open={openApplication} />
                  <Text variant="heading" style={styles.sectionTitle}>
                    Etapas das candidaturas
                  </Text>
                  <View
                    role="group"
                    style={[styles.metrics, stackedControls && styles.metricsStacked]}
                    accessibilityLabel="Filtrar candidaturas por etapa"
                  >
                    {statusFilters.map(({ id, label }) => (
                      <Pressable
                        key={id}
                        onPress={() => setStatusFilter(statusFilter === id ? "all" : id)}
                        accessibilityRole="button"
                        accessibilityLabel={`${counts[id]} ${label}`}
                        aria-pressed={Platform.OS === "web" ? statusFilter === id : undefined}
                        accessibilityState={
                          Platform.OS === "web" ? undefined : { selected: statusFilter === id }
                        }
                        style={({ pressed }) => [
                          styles.metric,
                          stackedControls && styles.stackedControl,
                          statusFilter === id && styles.metricActive,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text
                          variant="label"
                          style={[styles.metricValue, statusFilter === id && styles.white]}
                        >
                          {counts[id]}
                        </Text>
                        <Text
                          variant="caption"
                          style={[styles.metricLabel, statusFilter === id && styles.white]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {visibleApplications.length === 0 ? (
                    <Card style={styles.emptyList}>
                      <Text variant="label">Nenhuma candidatura nesta etapa.</Text>
                      <Button
                        label="Ver todas"
                        variant="outline"
                        onPress={() => setStatusFilter("all")}
                      />
                    </Card>
                  ) : null}
                  {visibleApplications.map((application) => (
                    <ApplicationCard
                      key={application.id}
                      application={application}
                      open={() => openApplication(application)}
                    />
                  ))}
                </View>
              )}
            </>
          ) : null}
        </View>
      ))}
      {dialog?.kind === "job" ? (
        <CareerDialog
          title="Revisar candidatura"
          close={closeDialog}
          saving={submitting && storage.saving}
          confirmClose={submitting && Boolean(storage.error)}
          footer={
            submitting && storage.error ? (
              <StorageNotice
                saving={false}
                error={storage.error}
                retry={() => void retryRegistration(dialog.job)}
                discard={closeDialog}
              />
            ) : (
              <Button
                label="Registrar candidatura"
                icon={Briefcase01Icon}
                busy={submitting && storage.saving}
                disabled={Boolean(storage.error)}
                onPress={() => void register(dialog.job)}
              />
            )
          }
        >
          <View style={styles.row}>
            <CompanyMark company={dialog.job.company} color={dialog.job.color} />
            <View style={styles.rowText}>
              <Text variant="label">{dialog.job.title}</Text>
              <Text variant="muted">{dialog.job.company}</Text>
            </View>
          </View>
          <Pill
            label={`${jobFit(dialog.job, data.base).score}% de compatibilidade`}
            tone="accent"
          />
          <Text>{dialog.job.description}</Text>
          <View style={styles.preview}>
            <Text variant="label">Destaques no currículo adaptado</Text>
            <Text variant="muted">
              {jobFit(dialog.job, data.base).skills.join(", ") ||
                "A versão conserva as competências do currículo base."}
            </Text>
          </View>
          <Text variant="muted">
            O Offboard registra a candidatura e salva uma versão do currículo. O envio à empresa é
            feito pelo canal da vaga.
          </Text>
        </CareerDialog>
      ) : null}
      {dialog?.kind === "application" ? (
        <CareerDialog title="Detalhes da candidatura" close={() => setDialog(null)}>
          <View style={styles.row}>
            <CompanyMark company={dialog.application.company} color={dialog.application.color} />
            <View style={styles.rowText}>
              <Text variant="label">{dialog.application.title}</Text>
              <Text variant="muted">{dialog.application.company}</Text>
            </View>
          </View>
          <Pill label={applicationStatusLabel(dialog.application)} tone="accent" />
          <Text variant="muted">Registrada em {displayDate(dialog.application.appliedAt)}.</Text>
          {dialog.application.status.kind === "interview" ? (
            <View style={styles.preview}>
              <View style={styles.row}>
                <Icon name={Video01Icon} size={19} color={colors.primary} />
                <Text variant="label" style={styles.rowText}>
                  {dialog.application.status.interview.title}
                </Text>
              </View>
              <Text>
                {displayDate(dialog.application.status.interview.date)} ·{" "}
                {dialog.application.status.interview.time}
              </Text>
              <Text variant="muted">{dialog.application.status.interview.format}</Text>
              <Text variant="muted">{dialog.application.status.interview.instructions}</Text>
            </View>
          ) : null}
          {dialog.application.versionId ? (
            <Button
              label="Abrir versão do currículo"
              icon={File01Icon}
              variant="outline"
              onPress={() => {
                const versionId = dialog.application.versionId;

                if (!versionId) return;
                setDialog(null);
                router.push({ pathname: "/curriculo", params: { versao: versionId } });
              }}
            />
          ) : null}
        </CareerDialog>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: {
    backgroundColor: colors.tint,
    borderRadius: radii.card,
    flexDirection: "row",
    gap: 4,
    padding: 4,
  },
  tabsStacked: { flexDirection: "column" },
  tab: {
    flex: 1,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    padding: 6,
    borderRadius: radii.card - 3,
  },
  tabActive: { backgroundColor: colors.background },
  tabStacked: { flex: 0 },
  pressed: { opacity: 0.72 },
  white: { color: colors.primaryForeground },
  muted: { color: colors.mutedForeground },
  list: { gap: 10 },
  hidden: { display: "none" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 },
  filter: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  filterSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  stackedControl: { flexBasis: "44%", flexGrow: 1 },
  filterLabel: { fontSize: 14, textAlign: "center" },
  jobCard: { gap: 14, padding: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  companyMark: {
    height: 42,
    width: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 2 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  applicationCard: { padding: 12, gap: 9 },
  calendar: { gap: 6, padding: 14 },
  calendarHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  sectionTitle: { fontSize: 18, lineHeight: 24, marginVertical: 2 },
  weekActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  weekRange: { flex: 1, textAlign: "center" },
  smallControl: {
    minHeight: 48,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: colors.tint,
  },
  todayControl: { minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center" },
  todayLabel: { color: colors.primary, fontFamily: fonts.bold },
  days: { flexDirection: "row", gap: 2, marginHorizontal: -6 },
  daysList: { gap: 4 },
  day: {
    alignItems: "center",
    borderRadius: 11,
    flex: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 55,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  daySelected: { backgroundColor: colors.primary },
  dayListItem: {
    flex: 0,
    minHeight: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  dayListLabel: { flexShrink: 1 },
  weekToggle: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 8,
  },
  weekToggleText: { color: colors.primary, flexShrink: 1 },
  dot: { width: 5, height: 5, marginTop: 1, borderRadius: 4 },
  event: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 4,
    padding: 11,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radii.card - 2,
    backgroundColor: colors.tint,
  },
  emptyEvent: { alignItems: "center", borderColor: colors.border, backgroundColor: colors.muted },
  eventStacked: { flexDirection: "column", gap: 4 },
  eventDetails: { gap: 2 },
  metrics: { flexDirection: "row", gap: 5 },
  metricsStacked: { flexWrap: "wrap" },
  metric: {
    flex: 1,
    minHeight: 64,
    paddingHorizontal: 4,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.tint,
    borderRadius: radii.card - 3,
    justifyContent: "center",
    alignItems: "center",
  },
  metricActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  metricValue: { fontSize: 23, lineHeight: 29 },
  metricLabel: { fontSize: 11, textAlign: "center" },
  emptyList: { gap: 10, alignItems: "flex-start" },
  loading: { flexDirection: "row", alignItems: "center", gap: 8 },
  feedback: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 10,
    borderRadius: radii.card,
    backgroundColor: "#E8F5EF",
  },
  preview: { borderRadius: radii.card, backgroundColor: colors.tint, padding: 12, gap: 5 },
});
