import { useEmployeeJourney } from "../../shared/employee-journey";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon";
import EyeIcon from "@hugeicons/core-free-icons/EyeIcon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Share01Icon from "@hugeicons/core-free-icons/Share01Icon";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import * as Clipboard from "expo-clipboard";
import { createURL } from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { type ComponentRef, type ReactNode, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  type TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { z } from "zod";
import { colors, fonts, radii } from "../../shared/theme";
import { Button, Card, Field, Icon, Screen, Text } from "../../shared/ui";
import { CareerDialog, Pill, StorageNotice } from "./components";
import { useCareerData } from "./data";
import {
  type CareerData,
  type Resume,
  type ResumeVersion,
  type Suggestion,
  demoName,
  demoVisits,
  displayDate,
  jobFit,
  jobs as demoJobs,
  localDate,
  resumeFormSchema,
  resumeScore,
  skillsList,
  suggestions,
  versionLabelSchema,
} from "./model";
import { exportResumePdf } from "./resume-pdf";

type Editor =
  | { kind: "base"; suggestion?: Suggestion }
  | { kind: "create" }
  | { kind: "version"; version: ResumeVersion };

const fields: ReadonlyArray<{ name: keyof Resume; label: string; multiline?: boolean }> = [
  { name: "name", label: "Nome no currículo" },
  { name: "headline", label: "Título profissional" },
  { name: "summary", label: "Resumo profissional", multiline: true },
  { name: "launchResult", label: "Experiência com lançamentos", multiline: true },
  { name: "campaignResult", label: "Experiência com campanhas", multiline: true },
  { name: "skills", label: "Competências separadas por vírgula", multiline: true },
];

type EditorValues = { label: string; company: string; resume: Resume };

const editorFields = [
  { name: "label", label: "Nome da versão" },
  { name: "company", label: "Empresa" },
  ...fields.map(({ name, label }) => ({ name: `resume.${name}`, label })),
];

const publicationSaveError = "Não foi possível atualizar a visibilidade da prévia.";

function ResumeEditor({
  editor,
  base,
  close,
  save,
  submitted,
  storage,
}: {
  editor: Editor;
  base: Resume;
  close: () => void;
  save: (values: EditorValues) => Promise<void>;
  submitted: boolean;
  storage: ReturnType<typeof useCareerData>[2];
}) {
  const version = editor.kind === "version" ? editor.version : null;
  const suggestion = editor.kind === "base" ? editor.suggestion : undefined;
  const saving = submitted && storage.saving;
  const disabled = storage.pending || (Boolean(storage.error) && !submitted);
  const inputs = useRef(new Map<string, ComponentRef<typeof TextInput>>());

  function trackInput(name: string) {
    return (input: ComponentRef<typeof TextInput> | null) => {
      if (input) inputs.current.set(name, input);
      else inputs.current.delete(name);
    };
  }

  const schema = z.object({
    label: editor.kind === "base" ? z.string() : versionLabelSchema,
    company: z.string().trim(),
    resume: resumeFormSchema,
  });

  const form = useForm({
    defaultValues: {
      label: version?.label ?? "",
      company: version?.company ?? "",
      resume: version ? { ...version.resume, name: version.resume.name || base.name } : base,
    },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: schema },
    onSubmit: ({ value }) => save(schema.parse(value)),
    onSubmitInvalid: ({ formApi }) => {
      const [name, issues] = Object.entries(formApi.state.errorMap.onDynamic ?? {})[0] ?? [];

      if (submitted) storage.discardFailedWrite();

      const input = name ? inputs.current.get(name) : undefined;

      input?.focus();

      const issue = issues?.[0];

      if (Platform.OS === "ios" && input) {
        requestAnimationFrame(() => AccessibilityInfo.sendAccessibilityEvent(input, "focus"));
      } else if (Platform.OS === "ios" && issue) {
        AccessibilityInfo.announceForAccessibility(issue.message);
      }
    },
  });

  const title =
    editor.kind === "create"
      ? "Nova versão"
      : editor.kind === "base"
        ? "Editar currículo base"
        : "Editar versão";

  const visibleFields = suggestion
    ? fields.filter(({ name }) => name === suggestion.field)
    : fields;

  const pdf = usePdfExport();
  const saveError = submitted ? storage.error : null;

  return (
    <CareerDialog
      title={title}
      close={close}
      saving={saving}
      confirmClose={Boolean(saveError)}
      footer={
        <form.Subscribe selector={(state) => Object.keys(state.errorMap.onDynamic ?? {})[0]}>
          {(name) => {
            const field = editorFields.find((field) => field.name === name);

            if (saveError && !name && !saving) {
              return (
                <StorageNotice
                  saving={false}
                  error={saveError}
                  retry={() => void form.handleSubmit()}
                  discard={close}
                />
              );
            }

            return (
              <>
                {field && !saving ? (
                  <Button
                    label={`Revisar ${field.label.toLocaleLowerCase("pt-BR")}`}
                    variant="ghost"
                    onPress={() => inputs.current.get(field.name)?.focus()}
                  />
                ) : null}
                <Button
                  label="Salvar currículo"
                  busy={saving}
                  disabled={disabled && !saving}
                  onPress={() => void form.handleSubmit()}
                />
              </>
            );
          }}
        </form.Subscribe>
      }
    >
      {suggestion ? (
        <View style={styles.suggestionHelp}>
          <Pill label={`+${suggestion.points} pontos`} tone="accent" />
          <Text>{suggestion.text}</Text>
        </View>
      ) : null}
      {editor.kind !== "base" ? (
        <>
          <form.Field name="label">
            {(field) => (
              <Field
                label="Nome da versão"
                autoComplete="off"
                editable={!saving}
                ref={trackInput("label")}
                value={field.state.value}
                onChangeText={field.handleChange}
                onBlur={field.handleBlur}
                error={field.state.meta.errors[0]?.message}
              />
            )}
          </form.Field>
          <form.Field name="company">
            {(field) => (
              <Field
                label="Empresa (opcional)"
                editable={!saving}
                ref={trackInput("company")}
                value={field.state.value}
                onChangeText={field.handleChange}
                onBlur={field.handleBlur}
                error={field.state.meta.errors[0]?.message}
              />
            )}
          </form.Field>
        </>
      ) : null}
      {visibleFields.map(({ name, label, multiline }) => (
        <form.Field key={name} name={`resume.${name}`}>
          {(field) => (
            <Field
              label={label}
              multiline={multiline}
              autoFocus={name === suggestion?.field}
              editable={!saving}
              ref={trackInput(`resume.${name}`)}
              value={field.state.value}
              onChangeText={field.handleChange}
              onBlur={field.handleBlur}
              error={field.state.meta.errors[0]?.message}
            />
          )}
        </form.Field>
      ))}
      {version ? (
        <form.Subscribe selector={(state) => !state.isDefaultValue}>
          {(dirty) => (
            <>
              <Button
                label="Baixar PDF da versão"
                icon={Download01Icon}
                variant="outline"
                busy={pdf.busy}
                disabled={dirty || storage.pending}
                onPress={() => void pdf.download(form.state.values.resume)}
              />
              {dirty ? (
                <Text variant="caption">Salve as alterações para baixar a versão atualizada.</Text>
              ) : null}
            </>
          )}
        </form.Subscribe>
      ) : null}
      {pdf.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {pdf.error}
        </Text>
      ) : null}
    </CareerDialog>
  );
}

function usePdfExport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(resume: Resume) {
    setError(null);
    setBusy(true);

    try {
      await exportResumePdf(resume);
    } catch (failure) {
      const message =
        failure instanceof Error && failure.message.startsWith("Permita abrir")
          ? failure.message
          : "Não foi possível abrir o PDF. Tente novamente.";

      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, download };
}

function VisitChart() {
  const totalVisits = demoVisits.reduce((total, { visits }) => total + visits, 0);
  const recruiterVisits = demoVisits.reduce((total, { recruiters }) => total + recruiters, 0);
  const maxVisits = Math.max(...demoVisits.map(({ visits }) => visits));

  return (
    <View style={styles.analytics}>
      <Text variant="caption" style={styles.darkText}>
        Visitas de exemplo
      </Text>
      <View style={styles.visits}>
        <Text style={styles.total}>{totalVisits}</Text>
        <Text
          variant="caption"
          style={styles.darkText}
        >{`visitas nesta semana · ${recruiterVisits} de recrutadores`}</Text>
      </View>
      <View style={styles.chart}>
        {demoVisits.map(({ day, visits }) => (
          <View
            key={day}
            accessibilityRole="image"
            accessibilityLabel={`${day}, ${visits} visitas`}
            style={styles.chartColumn}
          >
            <View style={styles.chartTrack}>
              <View
                style={[
                  styles.chartBar,
                  { height: (60 * visits) / maxVisits },
                  visits === maxVisits && styles.chartPeak,
                ]}
              />
            </View>
            <Text variant="caption" style={styles.darkText} aria-hidden>
              {day[0]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PublicationCard({
  resume,
  published,
  setPublished,
  disabled,
  recovery,
  showSampleVisits,
}: {
  resume: Resume;
  published: boolean;
  setPublished: (value: boolean) => void;
  disabled: boolean;
  recovery: ReactNode;
  showSampleVisits: boolean;
}) {
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const pdf = usePdfExport();

  async function copyPreview(message = "Link da prévia copiado.") {
    try {
      const success = await Clipboard.setStringAsync(createURL("curriculo-publico"));
      setFeedback(
        success
          ? { message, error: false }
          : { message: "Não foi possível copiar o link.", error: true },
      );
    } catch {
      setFeedback({ message: "Não foi possível copiar o link.", error: true });
    }
  }

  async function sharePreview() {
    if (Platform.OS === "web" && !navigator.share) {
      await copyPreview("Link copiado para compartilhar.");

      return;
    }

    try {
      const message = "Atalho para a prévia do currículo na sua sessão do Offboard.";
      const url = createURL("curriculo-publico");

      await Share.share(
        Platform.OS === "android" ? { message: `${message}\n${url}` } : { message, url },
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;

      setFeedback({ message: "Não foi possível compartilhar o link da prévia.", error: true });
    }
  }

  return (
    <Card tone="brand" style={styles.publication}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text variant="heading" style={[styles.sectionTitle, styles.white]}>
            Sua página do currículo
          </Text>
          <Text variant="caption" style={styles.darkText}>
            {published ? "Visível na prévia do app" : "Prévia oculta"}
          </Text>
        </View>
        <Switch
          accessibilityLabel="Mostrar currículo na prévia do app"
          trackColor={{ false: "#7B6399", true: colors.primary }}
          thumbColor={colors.background}
          ios_backgroundColor="#7B6399"
          disabled={disabled}
          value={published}
          onValueChange={(value) => {
            setFeedback(null);
            setPublished(value);
          }}
        />
      </View>
      {recovery}
      {published && showSampleVisits ? <VisitChart /> : null}
      <View style={styles.actionRow}>
        {published ? (
          <View style={styles.action}>
            <Button label="Copiar link" icon={Copy01Icon} onPress={() => void copyPreview()} />
          </View>
        ) : null}
        <View style={styles.action}>
          <Button
            label="Baixar PDF"
            icon={Download01Icon}
            variant="outline"
            busy={pdf.busy}
            onPress={() => void pdf.download(resume)}
          />
        </View>
      </View>
      {published ? (
        <>
          <View style={styles.publicLinks}>
            <Pressable
              accessibilityRole="link"
              style={styles.linkControl}
              onPress={() => router.push("/curriculo-publico")}
            >
              <Icon name={EyeIcon} size={17} color={styles.darkText.color} />
              <Text variant="label" style={styles.white}>
                Ver prévia
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.linkControl}
              onPress={() => void sharePreview()}
            >
              <Icon name={Share01Icon} size={17} color={styles.darkText.color} />
              <Text variant="label" style={styles.white}>
                Compartilhar link
              </Text>
            </Pressable>
          </View>
          <Text variant="caption" style={styles.darkText}>
            O link abre a prévia na sua sessão. Envie o PDF para compartilhar o currículo.
          </Text>
        </>
      ) : null}
      {feedback ? (
        <Text
          accessibilityRole={feedback.error ? "alert" : undefined}
          accessibilityLiveRegion="polite"
          variant="caption"
          style={styles.darkText}
        >
          {feedback.message}
        </Text>
      ) : null}
      {pdf.error ? (
        <Text accessibilityRole="alert" variant="caption" style={styles.darkText}>
          {pdf.error}
        </Text>
      ) : null}
    </Card>
  );
}

function versionSubtitle(data: CareerData, version: ResumeVersion) {
  const application = data.applications.find((item) => item.versionId === version.id);
  const status = application ? "Vinculada à candidatura" : "Rascunho";

  return [version.company, status].filter(Boolean).join(" · ");
}

export function ResumeScreen({ name = demoName }: { name?: string }) {
  const params = useLocalSearchParams<{ versao?: string }>();
  const { width, fontScale } = useWindowDimensions();
  const stackedSuggestions = width < 390 || fontScale > 1.1;
  const stackedScore = fontScale > 1.1;
  const [data, update, storage] = useCareerData();
  const employeeJourney = useEmployeeJourney();
  const jobs = employeeJourney?.plan.jobs ?? demoJobs;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const selectedVersion = data.versions.find(({ id }) => id === params.versao);

  const activeEditor =
    editor ?? (selectedVersion ? { kind: "version", version: selectedVersion } : null);

  const base = { ...data.base, name: data.base.name || name };
  const score = resumeScore(data.base);
  const openSuggestions = suggestions.filter((suggestion) => !suggestion.resolved(data.base));
  const disabled = storage.pending || Boolean(storage.error);
  const publicationFailed = storage.error === publicationSaveError;

  function closeEditor() {
    if (saveMessage) storage.discardFailedWrite();

    setEditor(null);
    setSaveMessage("");

    if (params.versao) router.setParams({ versao: undefined });
  }

  function saved(message: string) {
    setNotice(message);
    closeEditor();
  }

  async function saveEditor(values: EditorValues) {
    if (!activeEditor || storage.pending || (storage.error && !saveMessage)) return;

    const message =
      activeEditor.kind === "base" ? "Currículo base atualizado." : "Versão atualizada.";

    const errorMessage =
      activeEditor.kind === "base"
        ? "Não foi possível salvar o currículo base."
        : "Não foi possível salvar esta versão do currículo.";

    const updatedAt = localDate();

    setSaveMessage(message);

    const submitted = await update(
      (previous) => {
        if (activeEditor.kind === "base") {
          return { ...previous, base: values.resume, baseUpdatedAt: updatedAt };
        }

        if (activeEditor.kind === "create") {
          const version: ResumeVersion = {
            id: `manual-${previous.versions.length + 1}`,
            match: null,
            updatedAt,
            ...values,
          };

          return { ...previous, versions: [version, ...previous.versions] };
        }

        const original = activeEditor.version;

        const application = previous.applications.find(
          ({ versionId }) => versionId === original.id,
        );

        const job = jobs.find(({ id }) => id === application?.jobId);
        const match = job ? jobFit(job, values.resume).score : original.match;

        const versions = previous.versions.map((version) =>
          version.id === original.id ? { ...version, ...values, updatedAt, match } : version,
        );

        return { ...previous, versions };
      },
      { errorMessage },
    );

    if (submitted) saved(message);
  }

  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        Seu currículo
      </Text>
      {!publicationFailed && (!activeEditor || !saveMessage) ? (
        <StorageNotice
          saving={storage.saving}
          error={storage.error}
          retry={storage.retry}
          discard={storage.readFailed ? undefined : storage.discardFailedWrite}
        />
      ) : null}
      {storage.loading ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text variant="muted">Carregando seu currículo…</Text>
        </View>
      ) : storage.readFailed ? null : (
        <>
          {notice && !storage.pending && !storage.error ? (
            <View style={styles.notice}>
              <Icon name={CheckmarkCircle02Icon} size={18} color={colors.success} />
              <Text accessibilityLiveRegion="polite" style={styles.success}>
                {notice}
              </Text>
            </View>
          ) : null}
          <Card style={styles.scoreCard}>
            <View style={[styles.row, stackedScore && styles.scoreStack]}>
              <View
                style={[styles.score, stackedScore && styles.scoreExpanded]}
                accessibilityRole="image"
                accessibilityLabel={`Nota ${score} de 100`}
              >
                <Text style={styles.scoreValue}>{score}</Text>
              </View>
              <View style={stackedScore ? styles.scoreCopy : styles.rowText}>
                <Text variant="heading" style={styles.sectionTitle}>
                  Currículo base
                </Text>
                <Text variant="caption">
                  Nota de 0 a 100. Atualizado em {displayDate(data.baseUpdatedAt)}.
                </Text>
              </View>
            </View>
            <View style={styles.sectionHeader}>
              <Text variant="label" style={styles.muted}>
                {openSuggestions.length === 0
                  ? "Todas as sugestões foram revisadas."
                  : `${openSuggestions.length} ${openSuggestions.length === 1 ? "sugestão" : "sugestões"} para subir a nota`}
              </Text>
              <Pressable
                accessibilityRole="button"
                style={[styles.textControl, disabled && styles.disabled]}
                disabled={disabled}
                onPress={() => setEditor({ kind: "base" })}
              >
                <Text variant="label" style={styles.accent}>
                  Editar base
                </Text>
              </Pressable>
            </View>
            {openSuggestions.map((suggestion) => (
              <View
                key={suggestion.field}
                style={[styles.suggestion, stackedSuggestions && styles.suggestionStacked]}
              >
                <Text style={[styles.suggestionText, !stackedSuggestions && styles.rowText]}>
                  {suggestion.text}
                </Text>
                <Button
                  label={`Revisar · +${suggestion.points}`}
                  accessibilityLabel={`Revisar sugestão de ${suggestion.points} pontos. ${suggestion.text}`}
                  variant="outline"
                  disabled={disabled}
                  onPress={() => setEditor({ kind: "base", suggestion })}
                />
              </View>
            ))}
          </Card>
          <View style={styles.versions}>
            <View style={styles.sectionHeader}>
              <Text variant="heading" style={[styles.sectionTitle, styles.rowText]}>
                Uma versão para cada vaga
              </Text>
              <Pressable
                accessibilityRole="button"
                style={[styles.textControl, disabled && styles.disabled]}
                disabled={disabled}
                onPress={() => setEditor({ kind: "create" })}
              >
                <Icon name={PlusSignIcon} size={15} />
                <Text variant="label" style={styles.accent}>
                  Nova versão
                </Text>
              </Pressable>
            </View>
            {data.versions.map((version) => (
              <Pressable
                key={version.id}
                accessibilityRole="button"
                accessibilityLabel={[
                  `Editar versão ${version.label}`,
                  versionSubtitle(data, version),
                  version.match === null ? null : `${version.match}% de compatibilidade`,
                ]
                  .filter(Boolean)
                  .join(", ")}
                disabled={disabled}
                style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}
                onPress={() => setEditor({ kind: "version", version })}
              >
                <Card style={styles.versionCard}>
                  <View style={styles.versionIcon}>
                    <Icon name={File01Icon} size={19} />
                  </View>
                  <View style={styles.rowText}>
                    <Text variant="label">{version.label}</Text>
                    <Text variant="caption">{versionSubtitle(data, version)}</Text>
                    {version.match !== null ? (
                      <Pill label={`${version.match}% de compatibilidade`} tone="accent" />
                    ) : null}
                  </View>
                  <Icon name={ArrowRight01Icon} size={17} color={colors.mutedForeground} />
                </Card>
              </Pressable>
            ))}
          </View>
          <PublicationCard
            resume={base}
            published={data.published}
            showSampleVisits={!employeeJourney}
            disabled={disabled}
            recovery={
              publicationFailed ? (
                <StorageNotice
                  saving={false}
                  error={storage.error}
                  retry={storage.retry}
                  discard={storage.discardFailedWrite}
                />
              ) : null
            }
            setPublished={(published) =>
              update((previous) => ({ ...previous, published }), {
                errorMessage: publicationSaveError,
              })
            }
          />
        </>
      )}
      {activeEditor ? (
        <ResumeEditor
          editor={activeEditor}
          base={base}
          close={closeEditor}
          save={saveEditor}
          submitted={Boolean(saveMessage)}
          storage={storage}
        />
      ) : null}
    </Screen>
  );
}

export function ResumePublicScreen({ name = demoName }: { name?: string }) {
  const [data, , storage] = useCareerData();
  const resume = { ...data.base, name: data.base.name || name };
  const pdf = usePdfExport();

  return (
    <Screen>
      <Text variant="title">Prévia do currículo</Text>
      <StorageNotice
        saving={storage.saving}
        error={storage.error}
        retry={storage.retry}
        discard={storage.readFailed ? undefined : storage.discardFailedWrite}
      />
      {storage.loading ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text variant="muted">Carregando a prévia…</Text>
        </View>
      ) : storage.readFailed ? null : data.published ? (
        <>
          <Card style={styles.paper}>
            <View style={styles.paperHeader}>
              <Pill label="Prévia no app" tone="accent" />
              <Text variant="heading" style={styles.paperTitle}>
                {resume.name}
              </Text>
              <Text variant="label" style={styles.accent}>
                {resume.headline}
              </Text>
            </View>
            <View style={styles.resumeSection}>
              <Text variant="heading" style={styles.sectionTitle}>
                Resumo profissional
              </Text>
              <Text>{resume.summary}</Text>
            </View>
            <View style={styles.resumeSection}>
              <Text variant="heading" style={styles.sectionTitle}>
                Experiência e resultados
              </Text>
              <Text>{resume.launchResult}</Text>
              <Text>{resume.campaignResult}</Text>
            </View>
            <View style={styles.resumeSection}>
              <Text variant="heading" style={styles.sectionTitle}>
                Competências
              </Text>
              <View style={styles.skills}>
                {skillsList(resume.skills).map((skill) => (
                  <Pill key={skill} label={skill} />
                ))}
              </View>
            </View>
          </Card>
          <Button
            label="Baixar PDF"
            icon={Download01Icon}
            busy={pdf.busy}
            onPress={() => void pdf.download(resume)}
          />
          {pdf.error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {pdf.error}
            </Text>
          ) : null}
        </>
      ) : (
        <Card>
          <Icon name={Link01Icon} />
          <Text variant="heading" style={styles.sectionTitle}>
            A prévia está oculta
          </Text>
          <Text variant="muted">
            Ative a prévia na página do currículo para ver seus dados aqui.
          </Text>
        </Card>
      )}
      <Button
        label="Voltar ao currículo"
        variant="outline"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/curriculo"))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.55 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1, gap: 2 },
  sectionTitle: { fontSize: 17, lineHeight: 22 },
  muted: { color: colors.mutedForeground },
  accent: { color: colors.primary },
  white: { color: colors.primaryForeground },
  darkText: { color: "#E6D8F7" },
  scoreCard: { gap: 9 },
  scoreStack: { flexDirection: "column", alignItems: "flex-start" },
  scoreCopy: { gap: 2 },
  score: {
    width: 62,
    height: 62,
    borderRadius: 40,
    borderWidth: 5,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreExpanded: {
    width: "auto",
    height: "auto",
    minWidth: 62,
    minHeight: 62,
    padding: 8,
    borderRadius: radii.card,
    borderWidth: 2,
  },
  scoreValue: {
    fontSize: 23,
    lineHeight: 29,
    fontFamily: fonts.extrabold,
    color: colors.primary,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 6,
  },
  textControl: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 3,
  },
  suggestion: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  suggestionStacked: { flexDirection: "column", alignItems: "flex-start" },
  suggestionText: { fontSize: 14, lineHeight: 19 },
  suggestionHelp: { padding: 12, backgroundColor: colors.tint, borderRadius: radii.card, gap: 6 },
  versions: { gap: 8 },
  versionCard: { flexDirection: "row", alignItems: "center", gap: 9, padding: 12 },
  versionIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tint,
  },
  publication: { gap: 12 },
  analytics: { gap: 7 },
  visits: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 6 },
  total: {
    color: colors.primaryForeground,
    fontFamily: fonts.extrabold,
    fontSize: 35,
    lineHeight: 39,
    letterSpacing: -1.5,
  },
  chart: { flexDirection: "row", gap: 7 },
  chartColumn: { flex: 1, alignItems: "center", gap: 3 },
  chartTrack: { height: 61, width: "100%", justifyContent: "flex-end" },
  chartBar: { width: "100%", borderRadius: 6, backgroundColor: "#9E54FA" },
  chartPeak: { backgroundColor: "#DDC5FF" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { flex: 1, minWidth: 130 },
  publicLinks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 6 },
  linkControl: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    gap: 6,
    paddingHorizontal: 2,
  },
  pressed: { opacity: 0.68 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#E8F5EF",
    borderRadius: radii.card,
    padding: 9,
  },
  success: { color: colors.success, flex: 1 },
  error: { color: colors.destructive },
  paper: { gap: 20 },
  paperHeader: {
    gap: 3,
    paddingBottom: 12,
    borderBottomColor: colors.accent,
    borderBottomWidth: 2,
  },
  paperTitle: { marginTop: 5, fontSize: 26, lineHeight: 31 },
  resumeSection: { gap: 4 },
  skills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
