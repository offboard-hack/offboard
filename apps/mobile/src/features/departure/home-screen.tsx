import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Briefcase01Icon from "@hugeicons/core-free-icons/Briefcase01Icon";
import Calendar01Icon from "@hugeicons/core-free-icons/Calendar01Icon";
import { Link } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radii } from "../../shared/theme";
import { Card, Icon, Screen, Text } from "../../shared/ui";
import { useDeparturePlan, useDeparture } from "./departure-data";
import { departureStyles, IconBadge, Section, StepLink, StorageFeedback } from "./departure-ui";
import { getJourney } from "./journey";

export function HomeScreen({
  name,
  activity,
}: {
  name: string;
  activity?: { all: number; interviews: number };
}) {
  const plan = useDeparturePlan();
  const { departure } = plan;
  const [state, , storage] = useDeparture("confirmed");
  const journey = getJourney(state, plan);
  const firstName = name.trim().split(/\s+/, 1)[0] || "tudo bem?";

  const applicationSummary = activity
    ? `${activity.all} ${activity.all === 1 ? "candidatura" : "candidaturas"} · ${activity.interviews} ${activity.interviews === 1 ? "entrevista" : "entrevistas"}`
    : "Veja vagas e acompanhe suas candidaturas.";

  return (
    <Screen>
      <View style={departureStyles.stack}>
        <View style={styles.welcome}>
          <Text accessibilityRole="header" variant="title">
            Oi, {firstName}
          </Text>
          <Text variant="muted">{departure.currentDay}</Text>
        </View>

        <Link href="/rescisao" asChild>
          <Pressable accessibilityRole="link" style={styles.heroPressable}>
            <Card tone="brand" style={styles.deadline}>
              <View style={styles.deadlineRow}>
                <View style={styles.deadlineCopy}>
                  <Text variant="label" style={styles.lightText}>
                    Prazo da rescisão
                  </Text>
                  <Text accessibilityRole="text" variant="title" style={styles.deadlineTitle}>
                    Até {departure.deadlineShort}
                  </Text>
                </View>
                <View style={styles.deadlineIcon}>
                  <Icon name={Calendar01Icon} size={25} color={colors.primaryForeground} />
                </View>
              </View>
              <Text variant="body" style={styles.lightText}>
                Data prevista para a {departure.company} disponibilizar seus documentos e o
                pagamento.
              </Text>
            </Card>
          </Pressable>
        </Link>

        {storage.loading || storage.readFailed ? (
          <StorageFeedback {...storage} />
        ) : (
          <>
            <Section title="Para fazer agora">
              {journey.open.length > 0 ? (
                journey.open.map((step, index) => (
                  <StepLink key={step.href} {...step} divider={index < journey.open.length - 1} />
                ))
              ) : (
                <Text variant="muted">Você está em dia com suas tarefas.</Text>
              )}
            </Section>

            <Section title="Esperando a empresa">
              {journey.waiting.map((step) => (
                <StepLink key={step.href} {...step} divider={false} />
              ))}
            </Section>
            <StorageFeedback {...storage} />
          </>
        )}

        <Link href="/carreira" asChild>
          <Pressable accessibilityRole="link" style={styles.career}>
            <IconBadge name={Briefcase01Icon} />
            <View style={departureStyles.copy}>
              <Text variant="label">Sua busca por trabalho</Text>
              <Text variant="caption">{applicationSummary}</Text>
            </View>
            <Icon name={ArrowRight01Icon} color={colors.primary} size={18} />
          </Pressable>
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  welcome: { gap: 5 },
  heroPressable: { borderRadius: radii.card },
  deadline: { gap: 12 },
  deadlineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  deadlineCopy: { gap: 2, flex: 1 },
  deadlineTitle: { color: colors.primaryForeground },
  lightText: { color: colors.primaryForeground, opacity: 0.88 },
  deadlineIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: "#FFFFFF24",
    justifyContent: "center",
    alignItems: "center",
  },
  career: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.tint,
    borderRadius: radii.card,
    padding: 12,
    minHeight: 66,
  },
});
