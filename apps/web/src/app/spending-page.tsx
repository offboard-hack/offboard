import { createPortalAbility } from "@offboard/access";
import { getRouteApi, lazyRouteComponent } from "@tanstack/react-router";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/shadcn/tabs";
import {
  activeSpendingTab,
  spendingSearchSchema,
  visibleSpendingTabs,
  type SpendingTab,
} from "./spending-tabs";

const route = getRouteApi("/_portal/planos-e-gastos");

const PlansTab = lazyRouteComponent(() => import("@/features/billing/billing-page"), "PlansTab");

const BenefitsTab = lazyRouteComponent(
  () => import("@/features/benefits/benefits-page"),
  "BenefitsTab",
);

const labels = {
  plano: "Plano da empresa",
  beneficios: "Benefícios dos colaboradores",
} satisfies Record<SpendingTab, string>;

export function SpendingPage() {
  const { principal } = route.useRouteContext();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const ability = createPortalAbility(principal.role);

  const visible = visibleSpendingTabs({
    plan: ability.can("manage", "Integrations"),
    benefits: ability.can("read", "Billing"),
  });

  const active = activeSpendingTab(search.aba, visible);

  return (
    <ListPage title="Planos e gastos" breadcrumb={<ListBreadcrumb title="Planos e gastos" />}>
      <Tabs
        value={active}
        onValueChange={(value) => {
          const next = spendingSearchSchema.parse({ aba: value }).aba;
          void navigate({ search: { aba: next }, replace: true });
        }}
      >
        <TabsList aria-label="Seções de Planos e gastos">
          {visible.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {labels[tab]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="plano">
          <PlansTab
            paid={search.plano === "ok"}
            onSettled={() => void navigate({ search: { aba: search.aba }, replace: true })}
          />
        </TabsContent>
        <TabsContent value="beneficios">
          <BenefitsTab />
        </TabsContent>
      </Tabs>
    </ListPage>
  );
}
