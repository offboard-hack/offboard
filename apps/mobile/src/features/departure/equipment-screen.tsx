import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { employeeJourneyQueryKey } from "../../shared/employee-journey";
import { useCallback } from "react";
import Building01Icon from "@hugeicons/core-free-icons/Building01Icon";
import CalendarCheckIn01Icon from "@hugeicons/core-free-icons/CalendarCheckIn01Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import TruckDeliveryIcon from "@hugeicons/core-free-icons/TruckDeliveryIcon";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { type ComponentRef, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View } from "react-native";
import { SelectionControl } from "../../shared/selection-control";

import { colors, radii } from "../../shared/theme";
import { Button, Card, Field, Icon, Screen, Text } from "../../shared/ui";
import { Choice } from "./choice";
import {
  bookingFormSchema,
  bookingSchema,
  bookingSlotOptions,
  bookingSlots,
  getBookingDay,
  getBookingDescription,
  getBookingMethod,
  useDeparture,
  useDeparturePlan,
  type Booking,
  type BookingForm,
} from "./departure-data";
import {
  departureStyles,
  FieldError,
  IconBadge,
  PageTitle,
  Section,
  StorageFeedback,
} from "./departure-ui";

const methodOptions = [
  {
    value: "pickup",
    title: "Coleta em casa",
    description: "Uma transportadora busca os itens sem custo para você.",
    icon: TruckDeliveryIcon,
  },
  {
    value: "office",
    title: "Entregar no escritório",
    description: "Confira o endereço informado pelo RH.",
    icon: Building01Icon,
  },
] satisfies Array<{
  value: BookingForm["method"];
  title: string;
  description: string;
  icon: typeof TruckDeliveryIcon;
}>;

const bookingSaveError = "Não foi possível salvar o agendamento.";

export function EquipmentScreen() {
  const [state, update, storage] = useDeparture();
  const { departure, equipment, bookingDays, demo } = useDeparturePlan();
  const [editing, setEditing] = useState(false);
  const [editingDraft, setEditingDraft] = useState<Booking | null>(null);

  const pending = equipment.filter((item) => !item.received).length;
  const allReceived = equipment.length > 0 && pending === 0;
  const canBook = pending > 0 && bookingDays.length > 0;

  function stopEditing() {
    setEditing(false);
    setEditingDraft(null);
  }

  function editFailedBooking() {
    if (!state.booking) return;

    setEditingDraft(state.booking);
    setEditing(true);
    storage.discardFailedWrite();
  }

  const client = useQueryClient();

  useFocusEffect(
    useCallback(() => {
      void client.invalidateQueries({ queryKey: employeeJourneyQueryKey });
    }, [client]),
  );

  return (
    <Screen>
      <View style={departureStyles.stack}>
        <PageTitle
          title="Devolver equipamentos"
          description={`Escolha como devolver os itens da ${departure.company}.`}
        />
        {allReceived ? (
          <Card tone="subtle">
            <Text variant="heading">Devolução concluída</Text>
            <Text variant="muted">A equipe confirmou o recebimento de todos os bens.</Text>
          </Card>
        ) : null}
        {state.booking && pending > 0 && (!editing || !canBook) ? (
          <Card tone="subtle" style={styles.receipt}>
            <View style={styles.receiptTitle}>
              <IconBadge
                name={CalendarCheckIn01Icon}
                positive={!storage.pending && !storage.error}
              />
              <View style={departureStyles.copy} accessibilityLiveRegion="polite">
                <Text variant="heading">
                  {storage.pending || storage.error ? "Seu agendamento" : "Devolução agendada"}
                </Text>
                <Text variant="label">{getBookingMethod(state.booking)}</Text>
              </View>
            </View>
            <View style={departureStyles.group}>
              <Text variant="body">{getBookingDescription(state.booking)}</Text>
              <Text variant="muted">
                {state.booking.method === "pickup"
                  ? state.booking.address
                  : departure.officeAddress}
              </Text>
              {!storage.pending && !storage.error ? (
                <Text variant="caption">
                  {demo
                    ? "Agendamento de demonstração salvo neste dispositivo."
                    : "Agendamento salvo na sua conta."}
                </Text>
              ) : null}
            </View>
            <StorageFeedback {...storage} />
            {storage.error === bookingSaveError ? (
              <Button label="Editar agendamento" variant="secondary" onPress={editFailedBooking} />
            ) : canBook ? (
              <Button
                label="Alterar agendamento"
                variant="outline"
                disabled={storage.pending || Boolean(storage.error)}
                onPress={() => setEditing(true)}
              />
            ) : null}
          </Card>
        ) : null}

        <Section title={`Bens vinculados (${equipment.length})`}>
          {equipment.map((item, index) => (
            <View
              key={item.code}
              style={[styles.item, index < equipment.length - 1 && departureStyles.thinDivider]}
            >
              <Icon name={item.icon} size={21} color={colors.primary} />
              <View style={departureStyles.copy}>
                <Text variant="label">{item.title}</Text>
                <Text variant="caption">{[item.model, item.code].filter(Boolean).join(" · ")}</Text>
                {item.received ? (
                  <Text variant="caption" style={departureStyles.positiveText}>
                    Recebido
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </Section>

        {storage.loading || storage.readFailed ? <StorageFeedback {...storage} /> : null}
        {!allReceived && !canBook ? (
          <Card tone="subtle">
            <Text variant="muted">O RH ainda não disponibilizou datas para devolução.</Text>
          </Card>
        ) : null}
        {canBook && !storage.loading && !storage.readFailed && (!state.booking || editing) ? (
          <BookingEditor
            booking={editingDraft ?? state.booking}
            storage={storage}
            onSave={(booking) => {
              update((previous) => ({ ...previous, booking }), {
                errorMessage: bookingSaveError,
              });
              stopEditing();
            }}
            onCancel={state.booking || editingDraft ? stopEditing : undefined}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function BookingEditor({
  booking,
  onSave,
  onCancel,
  storage,
}: {
  booking: Booking | null;
  onSave: (booking: Booking) => void;
  onCancel?: () => void;
  storage: ReturnType<typeof useDeparture>[2];
}) {
  const { bookingDays, departure } = useDeparturePlan();

  const initial: BookingForm = {
    method: booking?.method === "office" && departure.officeAddress ? "office" : "pickup",
    day: booking && bookingDays.some((day) => day === booking.day) ? booking.day : null,
    slot: booking?.slot ?? null,
    address: booking?.method === "pickup" ? booking.address : "",
  };

  const firstDay = useRef<ComponentRef<typeof Choice>>(null);
  const firstSlot = useRef<ComponentRef<typeof Choice>>(null);
  const address = useRef<ComponentRef<typeof Field>>(null);

  const form = useForm({
    defaultValues: initial,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: bookingFormSchema },
    onSubmit: ({ value }) => {
      onSave(bookingSchema.parse(value));
    },
    onSubmitInvalid: ({ formApi }) => {
      const errors = formApi.state.errorMap.onDynamic;

      const target =
        (errors?.day && firstDay.current) ||
        (errors?.slot && firstSlot.current) ||
        (errors?.address && address.current);

      if (!target) return;

      target.focus();

      if (Platform.OS !== "web") {
        requestAnimationFrame(() => AccessibilityInfo.sendAccessibilityEvent(target, "focus"));
      }
    },
  });

  return (
    <View style={departureStyles.form}>
      <form.Field name="method">
        {(field) => (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Como prefere devolver?"
            style={departureStyles.group}
          >
            <Text variant="heading" accessibilityRole="header">
              Como prefere devolver?
            </Text>
            {methodOptions.map((method) => {
              if (method.value === "office" && !departure.officeAddress) return null;

              const checked = field.state.value === method.value;

              return (
                <SelectionControl
                  key={method.value}
                  role="radio"
                  selected={checked}
                  tabIndex={checked ? 0 : -1}
                  onPress={() => field.handleChange(method.value)}
                  style={({ pressed }) => [
                    styles.method,
                    checked && styles.selected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon name={method.icon} size={22} color={colors.primary} />
                  <View style={departureStyles.copy}>
                    <Text variant="label">{method.title}</Text>
                    <Text variant="caption">
                      {method.value === "office" ? departure.officeAddress : method.description}
                    </Text>
                  </View>
                  <View style={[styles.radio, checked && styles.radioChecked]}>
                    {checked ? (
                      <Icon name={Tick01Icon} size={12} color={colors.primaryForeground} />
                    ) : null}
                  </View>
                </SelectionControl>
              );
            })}
          </View>
        )}
      </form.Field>

      <form.Field name="day">
        {(field) => (
          <View style={departureStyles.group}>
            <Text variant="label">Dia</Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Dia da devolução"
              style={styles.choices}
            >
              {bookingDays.map((day, index) => (
                <Choice
                  key={day}
                  label={getBookingDay(day).label}
                  detail={getBookingDay(day).weekday}
                  accessibilityLabel={getBookingDay(day).fullLabel}
                  accessibilityHint={field.state.meta.errors[0]?.message}
                  ref={index === 0 ? firstDay : undefined}
                  layout="equal"
                  checked={field.state.value === day}
                  tabStop={field.state.value === day || (field.state.value === null && index === 0)}
                  onPress={() => field.handleChange(day)}
                />
              ))}
            </View>
            <FieldError error={field.state.meta.errors[0]?.message} />
          </View>
        )}
      </form.Field>

      <form.Field name="slot">
        {(field) => (
          <View style={departureStyles.group}>
            <Text variant="label">Horário</Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Horário da devolução"
              style={styles.choices}
            >
              {bookingSlotOptions.map((slot, index) => (
                <Choice
                  key={slot}
                  label={bookingSlots[slot]}
                  accessibilityHint={field.state.meta.errors[0]?.message}
                  ref={index === 0 ? firstSlot : undefined}
                  checked={field.state.value === slot}
                  tabStop={
                    field.state.value === slot || (field.state.value === null && index === 0)
                  }
                  onPress={() => field.handleChange(slot)}
                />
              ))}
            </View>
            <FieldError error={field.state.meta.errors[0]?.message} />
          </View>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.method}>
        {(method) =>
          method === "pickup" ? (
            <form.Field name="address">
              {(field) => (
                <Field
                  label="Endereço da coleta"
                  ref={address}
                  value={field.state.value}
                  onChangeText={field.handleChange}
                  onBlur={field.handleBlur}
                  autoComplete="street-address"
                  placeholder="Rua, número e cidade"
                  maxLength={240}
                  error={field.state.meta.errors[0]?.message}
                />
              )}
            </form.Field>
          ) : null
        }
      </form.Subscribe>

      <View style={departureStyles.group}>
        <Button
          label={booking ? "Salvar alterações" : "Confirmar agendamento"}
          icon={Tick01Icon}
          busy={storage.saving}
          disabled={storage.pending || Boolean(storage.error)}
          onPress={() => void form.handleSubmit()}
        />
        {onCancel ? <Button label="Cancelar edição" onPress={onCancel} variant="ghost" /> : null}
        <StorageFeedback {...storage} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  receipt: { gap: 12 },
  receiptTitle: { flexDirection: "row", alignItems: "center", gap: 10 },
  item: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 56, paddingVertical: 7 },
  method: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 68,
    padding: 12,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.control,
  },
  selected: { borderColor: colors.primary, backgroundColor: colors.tint },
  pressed: { opacity: 0.72 },
  radio: {
    width: 19,
    height: 19,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.mutedForeground,
    alignItems: "center",
    justifyContent: "center",
  },
  radioChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
