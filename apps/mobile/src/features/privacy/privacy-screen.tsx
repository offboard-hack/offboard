import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon";
import File02Icon from "@hugeicons/core-free-icons/File02Icon";
import SecurityCheckIcon from "@hugeicons/core-free-icons/SecurityCheckIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { useMutation } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SelectionControl } from "../../shared/selection-control";
import { colors, radii } from "../../shared/theme";
import { Button, Card, Icon, Screen, Text } from "../../shared/ui";
import { useAuth } from "../auth/session";
import { useConsent } from "./consent";

const documents = {
  terms: {
    title: "Termos de uso",
    subtitle: "Uso desta versão do aplicativo",
    icon: File02Icon,
    paragraphs: [
      "Você pode usar esta versão para explorar a jornada de saída e os recursos de carreira. Os casos, equipamentos e oportunidades apresentados são exemplos.",
      "Suas escolhas e alterações são salvas neste aparelho. Use exemplos ao preencher endereços, currículos e comentários nesta versão.",
    ],
  },
  privacy: {
    title: "Política de privacidade",
    subtitle: "Como esta versão trata seus dados",
    icon: SecurityCheckIcon,
    paragraphs: [
      "O aplicativo guarda preferências, feedback, candidaturas e currículos no aparelho. Se o acesso por e-mail estiver habilitado, o serviço de autenticação recebe os dados usados para criar a conta e entrar.",
      "Esta versão não envia seus dados da jornada ao RH. A página do currículo é uma prévia acessível dentro da sua sessão. Você decide com quem compartilhar um PDF exportado.",
    ],
  },
};

export function PrivacyScreen() {
  const [consent, update, storage] = useConsent();
  const { mode, signOut } = useAuth();
  const exit = useMutation({ mutationFn: signOut });
  const demo = mode === "demo";
  const [opened, setOpened] = useState<keyof typeof documents | null>(null);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const document = opened ? documents[opened] : null;

  const accountTerms = [
    "O Offboard reúne as informações de desligamento disponibilizadas pelo RH e ajuda a organizar seu currículo, feedback e candidaturas.",
    "Confirme diretamente com o RH as informações que ainda não estiverem disponíveis.",
  ];

  const accountPrivacy = [
    "O e-mail autorizado pelo RH protege seu acesso. Suas escolhas e alterações ficam vinculadas à sua conta e estão disponíveis no aplicativo e na web.",
    "A prévia do currículo exige sua sessão. Você decide com quem compartilhar um PDF exportado.",
  ];

  const saved = consent.accepted && !storage.pending && !storage.error;

  if (submitted && saved) return <Redirect href="/" />;

  if (document) {
    return (
      <Screen>
        <Button
          label="Voltar à privacidade"
          variant="ghost"
          icon={ArrowLeft01Icon}
          onPress={() => setOpened(null)}
        />
        <Text variant="title">{document.title}</Text>
        {(demo ? document.paragraphs : opened === "terms" ? accountTerms : accountPrivacy).map(
          (paragraph) => (
            <Text key={paragraph}>{paragraph}</Text>
          ),
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      {saved ? (
        <Button
          label="Voltar ao perfil"
          variant="ghost"
          icon={ArrowLeft01Icon}
          onPress={() => router.replace("/perfil")}
        />
      ) : null}
      <View style={styles.intro}>
        <Text variant="title">Sua jornada é privada</Text>
        <Text variant="muted">
          Veja como o Offboard trata as informações da sua saída e da sua transição de carreira.
        </Text>
      </View>
      <Card tone="subtle" style={styles.callout}>
        <Icon name={SecurityCheckIcon} size={23} />
        <View style={styles.grow}>
          <Text variant="label">
            {demo ? "Dados da jornada ficam neste aparelho" : "Dados vinculados à sua conta"}
          </Text>
          <Text variant="muted">
            {demo
              ? "O Offboard guarda suas tarefas, respostas, candidaturas e currículos neste aparelho."
              : "Seu progresso fica disponível no aplicativo e na web."}
          </Text>
        </View>
      </Card>
      <View>
        {Object.entries(documents).map(([key, item]) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            onPress={() => setOpened(key === "terms" ? "terms" : "privacy")}
            style={({ pressed }) => [styles.document, pressed && styles.pressed]}
          >
            <Icon name={item.icon} />
            <View style={styles.grow}>
              <Text variant="label">{item.title}</Text>
              <Text variant="caption">{item.subtitle}</Text>
            </View>
            <Icon name={ArrowRight02Icon} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>
      {storage.error ? (
        <View style={styles.intro}>
          <Text accessibilityRole="alert" style={styles.error}>
            {storage.error}
          </Text>
          <Button label="Tentar novamente" variant="outline" onPress={storage.retry} />
        </View>
      ) : null}
      {saved ? (
        <Text variant="muted">
          {demo
            ? "Suas escolhas estão salvas neste aparelho."
            : "Suas escolhas estão salvas na sua conta."}
        </Text>
      ) : (
        <View style={styles.intro}>
          <Check
            label="Li e aceito os Termos de uso."
            checked={terms}
            toggle={() => setTerms(!terms)}
          />
          <Check
            label="Li a Política de privacidade."
            checked={privacy}
            toggle={() => setPrivacy(!privacy)}
          />
          <Button
            label="Salvar escolhas e continuar"
            disabled={!terms || !privacy || Boolean(storage.error)}
            busy={storage.pending}
            onPress={() => {
              setSubmitted(true);
              update(() => ({ accepted: true }));
            }}
          />
        </View>
      )}
      {!demo && !saved ? (
        <View style={styles.intro}>
          <Button
            label="Sair da conta"
            variant="ghost"
            busy={exit.isPending}
            onPress={() => exit.mutate()}
          />
          {exit.isError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              Não foi possível sair da conta.
            </Text>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

function Check({
  label,
  checked,
  toggle,
}: {
  label: string;
  checked: boolean;
  toggle: () => void;
}) {
  return (
    <SelectionControl
      role="checkbox"
      accessibilityLabel={label}
      selected={checked}
      onPress={toggle}
      style={({ pressed }) => [styles.check, pressed && styles.pressed]}
    >
      <View style={[styles.checkSquare, checked && styles.checked]}>
        {checked ? <Icon name={Tick02Icon} color={colors.primaryForeground} size={17} /> : null}
      </View>
      <Text style={styles.grow}>{label}</Text>
    </SelectionControl>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  callout: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  grow: { flex: 1, gap: 4 },
  document: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  check: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radii.card,
  },
  checkSquare: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: colors.primary },
  error: { color: colors.destructive },
});
