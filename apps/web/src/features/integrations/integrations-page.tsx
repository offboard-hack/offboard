import {
  Clock01Icon,
  CreditCardIcon,
  File01Icon,
  HeartCheckIcon,
  LaptopIcon,
  Mail01Icon,
  MedicalFileIcon,
  RefreshIcon,
  Search01Icon,
  TruckIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { ComponentProps } from "react";
import {
  integrationsQuery,
  useToggleIntegration,
  type ConnectionStatus,
} from "@/entities/integration";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { PortalFilter } from "@/shared/ui/select";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import { Card } from "@/shared/ui/shadcn/card";
import { Input } from "@/shared/ui/shadcn/input";
import { Switch } from "@/shared/ui/shadcn/switch";

const categories = {
  communication: "Comunicação",
  payroll: "Folha e benefícios",
  accounts: "Acessos e contas",
  equipment: "Bens e coleta",
  finance: "Financeiro",
};

const connections = {
  connected: { label: "Conectada", variant: "status-success" },
  reconnect: { label: "Reconexão necessária", variant: "status-danger" },
  disconnected: { label: "Não conectada", variant: "secondary" },
} satisfies Record<string, { label: string; variant: ComponentProps<typeof Badge>["variant"] }>;

type Provider = {
  name: string;
  purpose: string;
};

type Integration = {
  name: string;
  purpose: string;
  category: keyof typeof categories;
  providers?: Provider[];
  comingSoon?: boolean;
} & (
  | { logo: `/brands/${string}.svg`; icon?: never }
  | { icon: ComponentProps<typeof HugeiconsIcon>["icon"]; logo?: never }
);

const catalog: Integration[] = [
  {
    name: "E-mail",
    category: "communication",
    icon: Mail01Icon,
    purpose: "Envia notificações e links de acesso por e-mail.",
  },
  {
    name: "Sistema de folha",
    category: "payroll",
    icon: File01Icon,
    purpose: "Envia cadastro, rescisão, eSocial e FGTS.",
    comingSoon: true,
  },
  {
    name: "Sistema de ponto",
    category: "payroll",
    icon: Clock01Icon,
    purpose: "Fecha ponto e banco de horas.",
    comingSoon: true,
  },
  {
    name: "Google Workspace",
    category: "accounts",
    logo: "/brands/google.svg",
    purpose: "Bloqueia acessos e transfere arquivos.",
    comingSoon: true,
  },
  {
    name: "Slack",
    category: "accounts",
    logo: "/brands/slack.svg",
    purpose: "Bloqueia acessos e avisa as áreas responsáveis.",
    comingSoon: true,
  },
  {
    name: "HubSpot",
    category: "accounts",
    logo: "/brands/hubspot.svg",
    purpose: "Transfere negócios e contatos.",
    comingSoon: true,
  },
  {
    name: "Inventário de TI",
    category: "equipment",
    icon: LaptopIcon,
    purpose: "Lista os bens de cada pessoa e registra a entrada no estoque.",
    comingSoon: true,
  },
  {
    name: "Transportadora",
    category: "equipment",
    icon: TruckIcon,
    purpose: "Agenda e rastreia a coleta de equipamentos.",
    comingSoon: true,
    providers: [
      {
        name: "Correios",
        purpose: "Logística reversa, etiqueta e rastreio via API dos Correios.",
      },
    ],
  },
  {
    name: "Clínica ocupacional",
    category: "payroll",
    icon: MedicalFileIcon,
    purpose: "Agenda o exame demissional.",
    comingSoon: true,
  },
  {
    name: "Operadora do plano de saúde",
    category: "payroll",
    icon: HeartCheckIcon,
    purpose: "Informa o direito de manter o plano.",
    comingSoon: true,
  },
  {
    name: "Cartão corporativo",
    category: "finance",
    icon: CreditCardIcon,
    purpose: "Cancela cartões e lista despesas em aberto.",
    comingSoon: true,
  },
  {
    name: "Microsoft 365",
    category: "accounts",
    logo: "/brands/microsoft.svg",
    purpose: "Bloqueia acessos e transfere arquivos de trabalho.",
    comingSoon: true,
  },
];

const route = getRouteApi("/_portal/integracoes");

function searchKey(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function resolveStatus(statusMap: Map<string, ConnectionStatus>, key: string) {
  return statusMap.get(key) ?? ("disconnected" satisfies ConnectionStatus);
}

function deriveConnection(item: Integration, statusMap: Map<string, ConnectionStatus>) {
  if (item.providers) {
    const statuses = item.providers.map((p) => resolveStatus(statusMap, `${item.name}::${p.name}`));

    if (statuses.includes("connected")) return "connected";

    if (statuses.includes("reconnect")) return "reconnect";

    return "disconnected";
  }

  return resolveStatus(statusMap, item.name);
}

export function IntegrationsPage() {
  const { status = "" } = route.useSearch();
  const navigate = route.useNavigate();
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const query = searchKey(search);

  const { data: rows } = useSuspenseQuery(integrationsQuery);
  const toggle = useToggleIntegration();

  const statusMap = new Map(rows.map((r) => [r.name, r.status]));

  const systems = catalog.map((item) => ({
    item,
    connection: deriveConnection(item, statusMap),
  }));

  const effectiveStatus = status || "all";

  const visible = systems.filter(
    ({ item, connection }) =>
      (effectiveStatus === "all" ||
        effectiveStatus === connection ||
        (effectiveStatus === "disconnected" && connection === "reconnect")) &&
      searchKey(
        `${item.name} ${item.purpose} ${item.providers?.map((p) => p.name).join(" ") ?? ""}`,
      ).includes(query),
  );

  function updateConnection(key: string, connection: ConnectionStatus) {
    if (toggle.isPending) return;

    setAnnouncement("");

    const displayName = key.includes("::") ? key.split("::")[1] : key;

    toggle.mutate(
      { name: key, status: connection },
      { onSuccess: () => setAnnouncement(`${displayName}: ${connections[connection].label}.`) },
    );

    if (status && status !== connection) {
      searchInput.current?.focus({ preventScroll: true });
    }
  }

  return (
    <ListPage title="Integrações" breadcrumb={<ListBreadcrumb title="Integrações" />}>
      <p role="status" className="sr-only">
        {toggle.isPending ? "Atualizando conexão…" : announcement}
      </p>
      {toggle.isError && (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível atualizar a conexão. Tente novamente.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <HugeiconsIcon
            icon={Search01Icon}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchInput}
            type="search"
            aria-label="Buscar sistema"
            placeholder="Buscar sistema"
            className="min-h-11 rounded-full bg-input/30 pl-10"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </div>
        <PortalFilter
          label="Status da conexão"
          className="min-h-11 w-full sm:w-auto"
          value={status}
          onChange={(next) =>
            void navigate({
              search: {
                status:
                  next === "connected" || next === "disconnected" || next === "all"
                    ? next
                    : undefined,
              },
              resetScroll: false,
            })
          }
          items={[
            { value: "connected", label: "Conectadas" },
            { value: "disconnected", label: "Não conectadas" },
            { value: "all", label: "Todas as conexões" },
          ]}
        />
      </div>
      <div className="grid gap-7">
        {Object.entries(categories).map(([category, label]) => {
          const items = visible.filter(({ item }) => item.category === category);

          return (
            items.length > 0 && (
              <section
                key={category}
                aria-labelledby={`integration-${category}`}
                className="grid gap-3"
              >
                <h2
                  id={`integration-${category}`}
                  className="flex items-baseline gap-2 text-sm font-semibold"
                >
                  {label}
                  <span className="font-normal text-muted-foreground tabular-nums">
                    ({items.length})
                  </span>
                </h2>
                <ul role="list" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map(({ item, connection }) => (
                    <li key={item.name}>
                      <IntegrationCard
                        item={item}
                        connection={connection}
                        statusMap={statusMap}
                        onChange={updateConnection}
                        pending={toggle.isPending}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )
          );
        })}
        {visible.length === 0 && (
          <Card role="status" className="px-5 py-10 text-center text-sm text-muted-foreground">
            Nenhum sistema corresponde à busca e aos filtros.
          </Card>
        )}
      </div>
    </ListPage>
  );
}

function IntegrationCard({
  item,
  connection,
  statusMap,
  onChange,
  pending,
}: {
  item: Integration;
  connection: ConnectionStatus;
  statusMap: Map<string, ConnectionStatus>;
  pending: boolean;
  onChange: (key: string, connection: ConnectionStatus) => void;
}) {
  const { label, variant } = connections[connection];
  const switchButton = useRef<HTMLButtonElement>(null);

  const providers = (item.providers ?? []).map((p) => ({
    name: p.name,
    purpose: p.purpose,
    connection: resolveStatus(statusMap, `${item.name}::${p.name}`),
  }));

  const hasProviders = providers.length > 0;
  const connectedCount = providers.filter((p) => p.connection === "connected").length;

  if (item.comingSoon) {
    return (
      <Card size="sm" className="flex h-full flex-col gap-3 p-4 opacity-50 grayscale">
        <div className="flex items-center justify-between gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border bg-muted/30 text-muted-foreground">
            {item.logo ? (
              <img
                src={item.logo}
                alt=""
                width={22}
                height={22}
                className="size-[22px] object-contain"
              />
            ) : (
              <HugeiconsIcon icon={item.icon} aria-hidden="true" className="size-5" />
            )}
          </span>
        </div>
        <div className="grid flex-1 content-start gap-1">
          <h3 className="text-base leading-tight font-semibold">{item.name}</h3>
          <p className="text-sm text-muted-foreground">{item.purpose}</p>
        </div>
        <div className="flex min-h-11 items-center border-t pt-3">
          <Badge variant="outline">Em breve</Badge>
        </div>
      </Card>
    );
  }

  return (
    <Card size="sm" className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border bg-muted/30 text-primary">
          {item.logo ? (
            <img
              src={item.logo}
              alt=""
              width={22}
              height={22}
              className="size-[22px] object-contain"
            />
          ) : (
            <HugeiconsIcon icon={item.icon} aria-hidden="true" className="size-5" />
          )}
        </span>

        {!hasProviders && (
          <Switch
            ref={switchButton}
            disabled={pending}
            aria-label={item.name}
            checked={connection === "connected"}
            onCheckedChange={(checked) =>
              onChange(item.name, checked ? "connected" : "disconnected")
            }
            className="mr-2 data-unchecked:bg-muted-foreground/65 motion-reduce:transition-none motion-reduce:[&_[data-slot=switch-thumb]]:transition-none"
          />
        )}
      </div>

      <div className="grid flex-1 content-start gap-1">
        <h3 className="text-base leading-tight font-semibold">{item.name}</h3>
        <p className="text-sm text-muted-foreground">{item.purpose}</p>
      </div>

      {hasProviders && (
        <ul role="list" className="grid gap-1 border-t pt-3">
          {providers.map((provider) => (
            <li
              key={provider.name}
              className="flex items-center justify-between gap-3 rounded-lg px-1 py-1.5"
            >
              <div className="grid min-w-0 gap-0.5">
                <span className="truncate text-sm font-medium">{provider.name}</span>

                <span className="truncate text-xs text-muted-foreground">{provider.purpose}</span>
              </div>

              <Switch
                aria-label={provider.name}
                disabled={pending}
                checked={provider.connection === "connected"}
                onCheckedChange={(checked) =>
                  onChange(`${item.name}::${provider.name}`, checked ? "connected" : "disconnected")
                }
                className="shrink-0 data-unchecked:bg-muted-foreground/65 motion-reduce:transition-none motion-reduce:[&_[data-slot=switch-thumb]]:transition-none"
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3">
        <Badge variant={variant}>{label}</Badge>

        {hasProviders ? (
          <span className="text-xs text-muted-foreground">
            {connectedCount} de {providers.length} ativos
          </span>
        ) : connection === "reconnect" ? (
          <Button
            variant="outline"
            size="sm"
            className="min-h-10"
            aria-label={`Reconectar ${item.name}`}
            disabled={pending}
            onClick={() => {
              switchButton.current?.focus({ preventScroll: true });
              onChange(item.name, "connected");
            }}
          >
            <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" aria-hidden="true" />
            Reconectar
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {connection !== "connected" && "Ative para conectar"}
          </span>
        )}
      </div>
    </Card>
  );
}
