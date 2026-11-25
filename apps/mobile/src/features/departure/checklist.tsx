import Task01Icon from "@hugeicons/core-free-icons/Task01Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import { employeeDate, employeeGrantHeader } from "@offboard/employee";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { StyleSheet, View } from "react-native";
import { employeeJourneyQueryKey, useEmployeeJourney } from "../../shared/employee-journey";
import { SelectionControl } from "../../shared/selection-control";
import { Text } from "../../shared/ui";
import { getEmployeeApi, useAuth } from "../auth/session";
import { departureStyles, FieldError, IconBadge, Section, StepLink } from "./departure-ui";

export function EmployeeChecklist() {
  const journey = useEmployeeJourney();
  const { session } = useAuth();
  const client = useQueryClient();

  const grant =
    session.status === "signed-in" && session.account.mode === "better-auth"
      ? session.account
      : null;

  const write = useMutation({
    async mutationFn({ taskId, done }: { taskId: string; done: boolean }) {
      if (!grant) throw new Error("Entre para atualizar sua etapa.");

      const result = await getEmployeeApi()
        .api.employee.checklist({ taskId })
        .patch({ done }, { headers: { [employeeGrantHeader]: grant.grantId } });

      if (result.error) throw new Error("Não foi possível atualizar a etapa. Tente novamente.");

      return result.data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: employeeJourneyQueryKey }),
  });

  if (!grant || !journey?.checklist.length) return null;

  return (
    <Section title="Checklist do desligamento">
      {journey.checklist.map((item, index) => {
        const completed = item.status === "done";
        const divider = index < journey.checklist.length - 1;

        const dueDate = item.dueDate
          ? `Prazo até ${employeeDate(item.dueDate, { day: "numeric", month: "long" })}`
          : "";

        if (item.action !== "check") {
          return (
            <StepLink
              key={item.id}
              href={item.action === "equipment" ? "/equipamentos" : "/feedback"}
              title={item.title}
              description={dueDate || (completed ? "Concluída" : "Abrir etapa")}
              icon={Task01Icon}
              complete={completed}
              divider={divider}
            />
          );
        }

        return (
          <View key={item.id} style={divider && departureStyles.thinDivider}>
            <SelectionControl
              role="checkbox"
              selected={completed}
              disabled={write.isPending}
              onPress={() => write.mutate({ taskId: item.id, done: !completed })}
              style={styles.row}
            >
              <IconBadge name={completed ? Tick01Icon : Task01Icon} positive={completed} />
              <View style={departureStyles.copy}>
                <Text variant="label">{item.title}</Text>
                {item.description ? <Text variant="caption">{item.description}</Text> : null}
                {dueDate ? <Text variant="caption">{dueDate}</Text> : null}
              </View>
            </SelectionControl>
            {write.variables?.taskId === item.id ? (
              <FieldError error={write.error?.message} />
            ) : null}
          </View>
        );
      })}
      {write.isPending ? (
        <Text accessibilityLiveRegion="polite" variant="caption">
          Salvando…
        </Text>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
});
