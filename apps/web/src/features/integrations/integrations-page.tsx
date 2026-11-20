import {
  Clock01Icon,
  CreditCardIcon,
  File01Icon,
  HeartCheckIcon,
  LaptopIcon,
  MedicalFileIcon,
  RefreshIcon,
  Search01Icon,
  TruckIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getRouteApi } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { ComponentProps } from "react";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { PortalFilter } from "@/shared/ui/select";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import { Card } from "@/shared/ui/shadcn/card";
import { Input } from "@/shared/ui/shadcn/input";
import { Switch } from "@/shared/ui/shadcn/switch";

const categories = {
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

type Connection = keyof typeof connections;

type Integration = {
  name: string;
  purpose: string;
  category: keyof typeof categories;
} & (
  | { logo: `/brands/${string}.svg`; icon?: never }
  | { icon: ComponentProps<typeof HugeiconsIcon>["icon"]; logo?: never }
) &
  (
    | { status: "connected" | "reconnect"; update: string }
    | { status: "disconnected"; update?: never }
  );

const integrations: Integration[] = [
  {
    name: "Sistema de folha",
    category: "payroll",
    icon: File01Icon,
    purpose: "Envia cadastro, rescisão, eSocial e FGTS.",
    status: "connected",
    update: "8 nov, 7h30 · 23 cadastros atualizados",
  },
  {
    name: "Sistema de ponto",
    category: "payroll",
    icon: Clock01Icon,
    purpose: "Fecha ponto e banco de horas.",
    status: "reconnect",
    update: "4 nov · 23 fechamentos",
  },
  {
    name: "Google Workspace",
    category: "accounts",
    logo: "/brands/google.svg",
    purpose: "Bloqueia acessos e transfere arquivos.",
    status: "connected",
    update: "3 nov · 21 contas atualizadas",
  },
  {
    name: "Slack",
    category: "accounts",
    logo: "/brands/slack.svg",
    purpose: "Bloqueia acessos e avisa as áreas responsáveis.",
    status: "connected",
    update: "8 nov, 8h02 · 14 avisos",
  },
  {
    name: "HubSpot",
    category: "accounts",
    logo: "/brands/hubspot.svg",
    purpose: "Transfere negócios e contatos.",
    status: "connected",
    update: "4 nov · 61 negócios transferidos",
  },
  {
    name: "Inventário de TI",
    category: "equipment",
    icon: LaptopIcon,
    purpose: "Lista os bens de cada pessoa e registra a entrada no estoque.",
    status: "connected",
    update: "8 nov, 9h40 · 2 itens conferidos",
  },
  {
    name: "Transportadora",
    category: "equipment",
    icon: TruckIcon,
    purpose: "Agenda e rastreia a coleta em casa.",
    status: "connected",
    update: "8 nov, 9h12 · Coleta confirmada",
  },
  {
    name: "Clínica ocupacional",
    category: "payroll",
    icon: MedicalFileIcon,
    purpose: "Agenda o exame demissional.",
    status: "connected",
    update: "4 nov · 23 agendamentos",
  },
  {
    name: "Operadora do plano de saúde",
    category: "payroll",
    icon: HeartCheckIcon,
    purpose: "Informa o direito de manter o plano.",
    status: "connected",
    update: "3 nov · 23 avisos",
  },
  {
    name: "Cartão corporativo",
    category: "finance",
    icon: CreditCardIcon,
    purpose: "Cancela cartões e lista despesas em aberto.",
    status: "disconnected",
  },
  {
    name: "Microsoft 365",
    category: "accounts",
    logo: "/brands/microsoft.svg",
    purpose: "Bloqueia acessos e transfere arquivos de trabalho.",
    status: "disconnected",
  },
];

const route = getRouteApi("/integracoes");

function searchKey(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export function IntegrationsPage() {
  const { status = "" } = route.useSearch();
  const navigate = route.useNavigate();
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [overrides, setOverrides] = useState<Partial<Record<string, Connection>>>({});
  const [announcement, setAnnouncement] = useState("");
  const query = searchKey(search);

  const systems = integrations.map((item) => ({
    ...item,
    connection: overrides[item.name] ?? item.status,
  }));

  const visible = systems.filter(
    ({ name, purpose, connection }) =>
      (!status ||
        status === connection ||
        (status === "disconnected" && connection === "reconnect")) &&
      searchKey(`${name} ${purpose}`).includes(query),
  );

  function updateConnection(name: string, connection: Connection) {
    setOverrides((previous) => ({ ...previous, [name]: connection }));
    setAnnouncement(`${name}: ${connections[connection].label}.`);

    if (status && status !== connection) {
      searchInput.current?.focus({ preventScroll: true });
    }
  }

  return (
    <ListPage title="Integrações" breadcrumb={<ListBreadcrumb title="Integrações" />}>
      <p role="status" className="sr-only">
        {announcement}
      </p>
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
                status: next === "connected" || next === "disconnected" ? next : undefined,
              },
              resetScroll: false,
            })
          }
          items={[
            { value: "", label: "Todas as conexões" },
            { value: "connected", label: "Conectadas" },
            { value: "disconnected", label: "Não conectadas" },
          ]}
        />
      </div>
      <div className="grid gap-7">
        {Object.entries(categories).map(([category, label]) => {
          const items = visible.filter((item) => item.category === category);

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
                  {items.map((item) => (
                    <li key={item.name}>
                      <IntegrationCard
                        item={item}
                        connection={item.connection}
                        onChange={updateConnection}
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
  onChange,
}: {
  item: Integration;
  connection: Connection;
  onChange: (name: string, connection: Connection) => void;
}) {
  const { label, variant } = connections[connection];
  const switchButton = useRef<HTMLButtonElement>(null);

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
        <Switch
          ref={switchButton}
          aria-label={item.name}
          checked={connection === "connected"}
          onCheckedChange={(checked) => onChange(item.name, checked ? "connected" : "disconnected")}
          className="mr-2 data-unchecked:bg-muted-foreground/65 motion-reduce:transition-none motion-reduce:[&_[data-slot=switch-thumb]]:transition-none"
        />
      </div>
      <div className="grid flex-1 content-start gap-1">
        <h3 className="text-base leading-tight font-semibold">{item.name}</h3>
        <p className="text-sm text-muted-foreground">{item.purpose}</p>
      </div>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3">
        <Badge variant={variant}>{label}</Badge>
        {connection === "reconnect" ? (
          <Button
            variant="outline"
            size="sm"
            className="min-h-10"
            aria-label={`Reconectar ${item.name}`}
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
            {connection === "connected"
              ? (item.update ?? "Sem atividade ainda")
              : "Ative para conectar"}
          </span>
        )}
      </div>
    </Card>
  );
}
