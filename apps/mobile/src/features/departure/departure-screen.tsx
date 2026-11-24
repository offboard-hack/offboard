import TaskDone01Icon from "@hugeicons/core-free-icons/TaskDone01Icon";
import { StyleSheet, View } from "react-native";

import { colors } from "../../shared/theme";
import { Card, Screen, Text } from "../../shared/ui";
import { useDeparturePlan, useDeparture } from "./departure-data";
import { departureStyles, IconBadge, Section, StepLink, StorageFeedback } from "./departure-ui";
import { getJourney } from "./journey";

export function DepartureScreen() {
  const plan = useDeparturePlan();
  const { departure } = plan;
  const [state, , storage] = useDeparture("confirmed");
  const journey = getJourney(state, plan);
  const total = journey.total + 1;
  const completed = journey.complete.length + 1;
  const progress = Math.round((100 * completed) / total);

  return (
    <Screen>
      <View style={departureStyles.stack}>
        <View style={departureStyles.group}>
          <Text accessibilityRole="header" variant="title">
            Minha saída
          </Text>
          <Text variant="muted">
            Acompanhe suas tarefas e o que está com a {departure.company}.
          </Text>
        </View>

        {storage.loading || storage.readFailed ? (
          <StorageFeedback {...storage} />
        ) : (
          <>
            <Card tone="subtle" style={styles.progressCard}>
              <View style={styles.progressTop}>
                <IconBadge name={TaskDone01Icon} />
                <View style={departureStyles.copy}>
                  <Text variant="label">Etapas da saída</Text>
                  <Text variant="caption">
                    {completed} de {total} concluídas
                  </Text>
                </View>
                <Text variant="heading" style={departureStyles.highlightText}>
                  {progress}%
                </Text>
              </View>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel="Progresso das etapas da saída"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={completed}
                aria-valuetext={`${completed} de ${total}`}
                style={styles.progressTrack}
              >
                <View style={[styles.progressValue, { width: `${progress}%` }]} />
              </View>
            </Card>

            <Section title="Com você">
              {journey.open.length > 0 ? (
                journey.open.map((step, index) => (
                  <StepLink key={step.href} {...step} divider={index < journey.open.length - 1} />
                ))
              ) : (
                <Text variant="muted">Você está em dia com suas tarefas.</Text>
              )}
            </Section>

            <Section title="Com a empresa">
              {journey.waiting.map((step) => (
                <StepLink key={step.href} {...step} divider={false} />
              ))}
            </Section>

            <Section title="Concluídas">
              <View
                style={[
                  styles.completedRow,
                  journey.complete.length > 0 && departureStyles.thinDivider,
                ]}
              >
                <IconBadge name={TaskDone01Icon} positive />
                <View style={departureStyles.copy}>
                  <Text variant="label">Comunicação do desligamento</Text>
                  {departure.lastDay ? (
                    <Text variant="caption">Último dia de trabalho em {departure.lastDay}</Text>
                  ) : null}
                </View>
              </View>
              {journey.complete.map((step, index) => (
                <StepLink key={step.href} {...step} divider={index < journey.complete.length - 1} />
              ))}
            </Section>

            <Section title="Sua experiência">
              <StepLink {...journey.feedback} divider={false} />
            </Section>
            <StorageFeedback {...storage} />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progressCard: { gap: 14 },
  progressTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  progressTrack: {
    height: 7,
    borderRadius: 7,
    overflow: "hidden",
    backgroundColor: colors.border,
  },
  progressValue: { height: "100%", borderRadius: 7, backgroundColor: colors.primary },
  completedRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 62 },
});
