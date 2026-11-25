import { useEmployeeJourney } from "../../shared/employee-journey";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import SendIcon from "@hugeicons/core-free-icons/SendIcon";
import ShieldCheckIcon from "@hugeicons/core-free-icons/ShieldCheckIcon";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Switch, View, useWindowDimensions } from "react-native";

import { colors } from "../../shared/theme";
import { Button, Card, Field, Icon, Screen, Text } from "../../shared/ui";
import { Choice } from "./choice";
import {
  feedbackFormSchema,
  responseOptions,
  useDeparture,
  type Departure,
  type FeedbackForm,
} from "./departure-data";
import { departureStyles, FieldError, IconBadge, PageTitle, StorageFeedback } from "./departure-ui";

const ratings: Array<NonNullable<FeedbackForm["assessment"]>> = [1, 2, 3, 4, 5];

const initialFeedback: FeedbackForm = {
  anonymous: true,
  assessment: null,
  clarity: null,
  respect: null,
  comment: "",
  recommendation: "",
};

const feedbackSaveError = "Não foi possível salvar o feedback.";

export function FeedbackScreen() {
  const router = useRouter();
  const [state, update, storage] = useDeparture();
  const employeeJourney = useEmployeeJourney();
  const [draft, setDraft] = useState(initialFeedback);
  const returnToDeparture = () => router.navigate("/saida");

  function editFailedFeedback() {
    if (!state.feedback) return;

    setDraft({
      ...state.feedback,
      recommendation: state.feedback.recommendation?.toString() ?? "",
    });
    storage.discardFailedWrite();
  }

  return (
    <Screen>
      <View style={departureStyles.stack}>
        <PageTitle
          title={state.feedback ? "Feedback da saída" : "Como foi sua experiência?"}
          description={
            state.feedback
              ? undefined
              : "Sua percepção ajuda a melhorar o processo de saída. Escolha quais perguntas responder."
          }
          aside={
            state.feedback || storage.loading || storage.readFailed ? undefined : (
              <Button label="Pular" variant="ghost" onPress={returnToDeparture} />
            )
          }
        />
        {storage.loading || storage.readFailed ? <StorageFeedback {...storage} /> : null}
        {state.feedback ? (
          <Card tone="subtle" style={styles.receipt}>
            <View style={styles.receiptHeader}>
              <IconBadge
                name={storage.pending || storage.error ? Message01Icon : CheckmarkCircle02Icon}
                positive={!storage.pending && !storage.error}
              />
              <View style={departureStyles.copy} accessibilityLiveRegion="polite">
                <Text variant="heading">
                  {storage.pending || storage.error ? "Seu feedback" : "Feedback salvo"}
                </Text>
                <Text variant="caption">
                  {employeeJourney
                    ? "Resposta salva na sua conta"
                    : state.feedback.anonymous
                      ? "Resposta anônima"
                      : "Resposta identificada"}
                </Text>
              </View>
            </View>
            {!storage.pending && !storage.error ? (
              <Text variant="body">
                Obrigado por compartilhar sua experiência. Sua resposta foi salva neste dispositivo.
              </Text>
            ) : null}
            <StorageFeedback {...storage} />
            {storage.error === feedbackSaveError ? (
              <Button label="Editar resposta" variant="secondary" onPress={editFailedFeedback} />
            ) : null}
            <Button
              label="Voltar para Saída"
              variant="outline"
              onPress={returnToDeparture}
              disabled={storage.pending}
            />
          </Card>
        ) : null}
        {!storage.loading && !storage.readFailed && !state.feedback ? (
          <FeedbackEditor
            draft={draft}
            storage={storage}
            onSave={(feedback) => {
              update((previous) => ({ ...previous, feedback }), {
                errorMessage: feedbackSaveError,
              });
              setDraft(initialFeedback);
            }}
            onSkip={returnToDeparture}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function FeedbackEditor({
  draft,
  onSave,
  onSkip,
  storage,
}: {
  draft: FeedbackForm;
  onSave: (feedback: NonNullable<Departure["feedback"]>) => void;
  onSkip: () => void;
  storage: ReturnType<typeof useDeparture>[2];
}) {
  const employeeJourney = useEmployeeJourney();

  const form = useForm({
    defaultValues: draft,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: feedbackFormSchema },
    onSubmit: ({ value }) => {
      const { recommendation, ...parsed } = feedbackFormSchema.parse(value);
      onSave({ ...parsed, recommendation: recommendation ? Number(recommendation) : null });
    },
  });

  return (
    <View style={departureStyles.form}>
      <form.Field name="anonymous">
        {(field) => (
          <View style={styles.anonymous}>
            <View style={departureStyles.copy}>
              <Text variant="label">
                {employeeJourney ? "Omitir meu nome em relatórios" : "Responder anonimamente"}
              </Text>
              <Text variant="caption">
                {field.state.value
                  ? employeeJourney
                    ? "Seu nome fica fora de relatórios."
                    : "Seu nome fica fora da resposta."
                  : "Você optou por identificar sua resposta."}
              </Text>
            </View>
            <Switch
              accessibilityLabel={
                employeeJourney ? "Omitir meu nome em relatórios" : "Responder anonimamente"
              }
              value={field.state.value}
              onValueChange={field.handleChange}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.primaryForeground}
            />
          </View>
        )}
      </form.Field>

      <Card tone="subtle" style={styles.note}>
        <Icon name={ShieldCheckIcon} color={colors.primary} size={21} />
        <View style={departureStyles.copy}>
          <Text variant="label">Privacidade da resposta</Text>
          <Text variant="caption">
            {employeeJourney
              ? "Sua resposta fica vinculada à conta. Você pode omitir seu nome em relatórios."
              : "Nesta demonstração, a resposta fica neste dispositivo."}
          </Text>
        </View>
      </Card>

      <form.Field name="assessment">
        {(field) => (
          <View style={departureStyles.group}>
            <Text accessibilityRole="header" variant="heading">
              Como você avalia a saída?
            </Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Nota da experiência"
              style={styles.choices}
            >
              {ratings.map((rating) => (
                <Choice
                  key={rating}
                  label={String(rating)}
                  accessibilityLabel={`Nota ${rating} de 5`}
                  layout="equal"
                  checked={field.state.value === rating}
                  tabStop={
                    field.state.value === rating || (field.state.value === null && rating === 1)
                  }
                  onPress={() => field.handleChange(rating)}
                />
              ))}
            </View>
            <View style={styles.scale}>
              <Text variant="caption">1 · Muito ruim</Text>
              <Text variant="caption">5 · Muito boa</Text>
            </View>
            {field.state.value !== null ? (
              <View style={styles.clearRating}>
                <Button
                  label="Limpar nota"
                  variant="ghost"
                  onPress={() => field.handleChange(null)}
                />
              </View>
            ) : null}
          </View>
        )}
      </form.Field>

      <form.Field name="clarity">
        {(field) => (
          <AnswerSelector
            label="A comunicação foi clara?"
            value={field.state.value}
            onSelect={field.handleChange}
          />
        )}
      </form.Field>

      <form.Field name="respect">
        {(field) => (
          <AnswerSelector
            label="Você recebeu um tratamento respeitoso?"
            value={field.state.value}
            onSelect={field.handleChange}
          />
        )}
      </form.Field>

      <form.Field name="comment">
        {(field) => (
          <View style={departureStyles.group}>
            <Field
              label="O que poderia ser melhor?"
              multiline
              maxLength={800}
              numberOfLines={3}
              placeholder="Deixe um comentário"
              value={field.state.value}
              onChangeText={field.handleChange}
              onBlur={field.handleBlur}
              style={styles.comment}
            />
            <Text variant="caption">Evite nomes e informações que possam identificar alguém.</Text>
          </View>
        )}
      </form.Field>

      <View style={departureStyles.group}>
        <Text accessibilityRole="header" variant="heading">
          Você recomendaria a empresa?
        </Text>
        <form.Field name="recommendation">
          {(field) => (
            <Field
              label="Nota de 0 a 10"
              value={field.state.value}
              onChangeText={field.handleChange}
              onBlur={field.handleBlur}
              keyboardType="number-pad"
              placeholder="De 0 a 10"
              maxLength={2}
              error={field.state.meta.errors[0]?.message}
            />
          )}
        </form.Field>
        <Text variant="caption">0 · Não recomendaria / 10 · Recomendaria muito</Text>
      </View>

      <View style={departureStyles.group}>
        <form.Subscribe selector={(state) => state.errorMap.onDynamic?.[""]?.[0]?.message}>
          {(error) =>
            error ? (
              <FieldError error={error} />
            ) : (
              <Text variant="caption">Responda pelo menos uma pergunta para enviar.</Text>
            )
          }
        </form.Subscribe>
        <form.Subscribe selector={(state) => state.values.anonymous}>
          {(anonymous) => (
            <Button
              label={
                employeeJourney
                  ? "Enviar feedback"
                  : anonymous
                    ? "Enviar feedback anônimo"
                    : "Enviar feedback identificado"
              }
              icon={SendIcon}
              busy={storage.saving}
              disabled={storage.pending || Boolean(storage.error)}
              onPress={() => void form.handleSubmit()}
            />
          )}
        </form.Subscribe>
        <Button label="Responder depois" variant="secondary" onPress={onSkip} />
        <StorageFeedback {...storage} />
      </View>
    </View>
  );
}

type Answer = FeedbackForm["clarity"];

function AnswerSelector({
  label,
  value,
  onSelect,
}: {
  label: string;
  value: Answer;
  onSelect: (value: Answer) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const layout = width < 360 || fontScale > 1.1 ? "twoColumns" : "equal";

  return (
    <View style={departureStyles.group}>
      <Text variant="label">{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choices}>
        {[...responseOptions, null].map((option) => (
          <Choice
            key={option ?? "skip"}
            label={option ?? "Sem resposta"}
            checked={value === option}
            tabStop={value === option}
            onPress={() => onSelect(option)}
            layout={layout}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anonymous: { flexDirection: "row", gap: 12, alignItems: "center", minHeight: 52 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  scale: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap" },
  clearRating: { alignSelf: "flex-start" },
  comment: { minHeight: 92, textAlignVertical: "top" },
  receipt: { gap: 14 },
  receiptHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
});
