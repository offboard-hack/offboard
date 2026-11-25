import Calendar01Icon from "@hugeicons/core-free-icons/Calendar01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import FirstAidKitIcon from "@hugeicons/core-free-icons/FirstAidKitIcon";
import Location01Icon from "@hugeicons/core-free-icons/Location01Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import { StyleSheet, View } from "react-native";
import { SelectionControl } from "../../shared/selection-control";

import { colors } from "../../shared/theme";
import { Button, Card, Icon, Screen, Text } from "../../shared/ui";
import { getHandoffCount, useDeparture, useDeparturePlan } from "./departure-data";
import { departureStyles, IconBadge, PageTitle, Section, StorageFeedback } from "./departure-ui";

export function HandoffScreen() {
  const [state, update, storage] = useDeparture();
  const { handoff } = useDeparturePlan();
  const count = getHandoffCount(state, handoff);

  const complete =
    !storage.pending && !storage.error && handoff.length > 0 && count === handoff.length;

  return (
    <Screen>
      <View style={departureStyles.stack}>
        <PageTitle
          title="Passar seu trabalho"
          description="Revise a lista com as pessoas que vão assumir cada item."
        />
        {storage.loading || storage.readFailed ? (
          <StorageFeedback {...storage} />
        ) : (
          <>
            <Card tone="subtle">
              <Text
                accessibilityLiveRegion="polite"
                variant="label"
                style={complete ? departureStyles.positiveText : departureStyles.highlightText}
              >
                {complete ? "Passagem concluída" : `${count} de ${handoff.length} itens marcados`}
              </Text>
            </Card>
            <Section title="Itens da passagem">
              {handoff.length === 0 ? (
                <Text variant="muted">Nenhum item informado pelo RH.</Text>
              ) : null}
              {handoff.map((task, index) => {
                const checked = state.handoffCompleted.includes(task.id);

                return (
                  <SelectionControl
                    key={task.id}
                    role="checkbox"
                    selected={checked}
                    disabled={Boolean(storage.error)}
                    onPress={() =>
                      update(
                        (previous) => ({
                          ...previous,
                          handoffCompleted: previous.handoffCompleted.includes(task.id)
                            ? previous.handoffCompleted.filter((id) => id !== task.id)
                            : [...previous.handoffCompleted, task.id],
                        }),
                        {
                          errorMessage: "Não foi possível salvar a revisão da passagem.",
                        },
                      )
                    }
                    style={({ pressed }) => [
                      styles.row,
                      index < handoff.length - 1 && departureStyles.thinDivider,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.checkbox, checked && styles.checked]}>
                      {checked ? (
                        <Icon name={Tick01Icon} size={15} color={colors.primaryForeground} />
                      ) : null}
                    </View>
                    <View style={departureStyles.copy}>
                      <Text variant="label">{task.title}</Text>
                      <Text variant="caption">
                        {task.owner} · {task.area}
                      </Text>
                    </View>
                  </SelectionControl>
                );
              })}
            </Section>
            <StorageFeedback {...storage} />
          </>
        )}
      </View>
    </Screen>
  );
}

export function ExamScreen() {
  const [state, update, storage] = useDeparture("confirmed");
  const { departure } = useDeparturePlan();
  const exam = departure.exam;

  return (
    <Screen>
      <View style={departureStyles.stack}>
        <PageTitle
          title="Exame demissional"
          description="Confira os dados do agendamento preparado pela empresa."
        />
        {exam ? (
          <>
            <Card tone="subtle" style={styles.details}>
              <View style={styles.detailsHeader}>
                <IconBadge name={FirstAidKitIcon} />
                <Text variant="heading" style={departureStyles.copy}>
                  {exam.clinic}
                </Text>
              </View>
              <View style={styles.fact}>
                <Icon name={Calendar01Icon} size={19} color={colors.primary} />
                <Text variant="body" style={departureStyles.copy}>
                  {exam.date}
                </Text>
              </View>
              <View style={styles.fact}>
                <Icon name={Location01Icon} size={19} color={colors.primary} />
                <Text variant="body" style={departureStyles.copy}>
                  {exam.address}
                </Text>
              </View>
            </Card>
            <Section title="No dia do exame">
              <Text variant="body">
                Leve um documento com foto e informe na recepção que o agendamento é pela{" "}
                {departure.company}.
              </Text>
            </Section>
            {!storage.loading && !storage.readFailed ? (
              <View style={departureStyles.group} accessibilityLiveRegion="polite">
                {state.examAttended ? (
                  <Text variant="label" style={departureStyles.positiveText}>
                    Comparecimento registrado
                  </Text>
                ) : null}
                <Button
                  variant={state.examAttended ? "outline" : "primary"}
                  label={state.examAttended ? "Desfazer confirmação" : "Registrar comparecimento"}
                  icon={state.examAttended ? undefined : Tick01Icon}
                  disabled={storage.pending || Boolean(storage.error)}
                  onPress={() =>
                    update((previous) => ({ ...previous, examAttended: !previous.examAttended }), {
                      errorMessage: "Não foi possível atualizar o comparecimento ao exame.",
                    })
                  }
                />
              </View>
            ) : null}
            <StorageFeedback {...storage} />
          </>
        ) : (
          <Card tone="subtle">
            <Text variant="muted">O RH ainda não informou o agendamento do exame.</Text>
          </Card>
        )}
      </View>
    </Screen>
  );
}

export function TerminationScreen() {
  const { departure } = useDeparturePlan();

  return (
    <Screen>
      <View style={departureStyles.stack}>
        <PageTitle
          title="Termo de rescisão"
          description="Acompanhe a entrega dos documentos de desligamento e a previsão de pagamento."
        />
        <Card tone="subtle" style={styles.details}>
          <View style={styles.detailsHeader}>
            <IconBadge name={File01Icon} />
            <View style={departureStyles.copy}>
              <Text variant="heading">Aguardando a empresa</Text>
              <Text variant="caption">{departure.company}</Text>
            </View>
          </View>
          <View style={styles.fact}>
            <Icon name={Calendar01Icon} size={19} color={colors.primary} />
            <Text variant="body" style={departureStyles.copy}>
              Previsto até {departure.deadline}
            </Text>
          </View>
        </Card>
        <Section title="Seus documentos">
          <Text variant="body">
            Consulte o RH para receber o termo de rescisão e o demonstrativo dos valores.
          </Text>
        </Section>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 62,
    paddingVertical: 9,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: colors.mutedForeground,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { borderColor: colors.primary, backgroundColor: colors.primary },
  pressed: { opacity: 0.7 },
  details: { gap: 14 },
  detailsHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  fact: { flexDirection: "row", alignItems: "center", gap: 9 },
});
