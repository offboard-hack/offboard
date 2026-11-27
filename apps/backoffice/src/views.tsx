import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Unauthorized } from "./access";
import { api } from "./api";
import { formatBRL, formatDay, pageCount } from "./format";

const pageSize = 25;

async function unwrap<T>(promise: Promise<{ data: T | null; error: unknown; status: number }>) {
  const result = await promise;

  if (result.status === 401) throw new Unauthorized();

  if (result.data === null) throw new Error("Falha ao carregar dados.");

  return result.data;
}

export function SummaryView() {
  const query = useQuery({
    queryKey: ["backoffice", "summary"],
    queryFn: () => unwrap(api.api.backoffice.summary.get()),
  });

  if (!query.data) return <p className="muted">Carregando…</p>;

  const summary = query.data;

  return (
    <section>
      <h2>Resumo</h2>
      <dl className="stats">
        <Stat label="Empresas" value={summary.organizations} />
        <Stat label="Usuários do portal" value={summary.teamMembers} />
        <Stat label="Talentos" value={summary.talentProfiles} />
        <Stat label="Casos de desligamento" value={summary.offboardingCases} />
        <Stat
          label="Receita recorrente ativa"
          value={formatBRL(summary.activeMonthlyRecurringCents)}
        />
        <Stat label="Chamadas de IA (30 dias)" value={summary.llmCallsLast30Days} />
      </dl>
      <h3>Assinaturas das empresas por status</h3>
      <StatusList counts={summary.subscriptionsByStatus} />
      <h3>Assinaturas dos talentos por status</h3>
      <StatusList counts={summary.talentSubscriptionsByStatus} />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StatusList({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts);

  if (entries.length === 0) return <p className="muted">Nenhum registro.</p>;

  return (
    <ul>
      {entries.map(([status, count]) => (
        <li key={status}>
          {status}: {count}
        </li>
      ))}
    </ul>
  );
}

export function OrganizationsView({ onOpen }: { onOpen: (id: string) => void }) {
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ["backoffice", "organizations", page],
    queryFn: () =>
      unwrap(
        api.api.backoffice.organizations.get({
          query: { limit: pageSize, offset: page * pageSize },
        }),
      ),
    placeholderData: keepPreviousData,
  });

  if (!query.data) return <p className="muted">Carregando…</p>;

  const pages = pageCount(query.data.total, pageSize);

  return (
    <section>
      <h2>Empresas</h2>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Usuários</th>
            <th>Casos</th>
            <th>Plano</th>
            <th>Status</th>
            <th>Criada em</th>
          </tr>
        </thead>
        <tbody>
          {query.data.items.map((org) => (
            <tr key={org.id}>
              <td>
                <button type="button" className="link" onClick={() => onOpen(org.id)}>
                  {org.name}
                </button>
              </td>
              <td>{org.memberCount}</td>
              <td>{org.caseCount}</td>
              <td>{org.subscription?.plan.name ?? "Sem plano"}</td>
              <td>{org.subscription?.status ?? "—"}</td>
              <td>{formatDay(org.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={page} pages={pages} onChange={setPage} />
    </section>
  );
}

function Pager({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  return (
    <nav aria-label="Paginação" className="pager">
      <button type="button" disabled={page === 0} onClick={() => onChange(page - 1)}>
        Anterior
      </button>
      <span>
        {page + 1} de {pages}
      </span>
      <button type="button" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>
        Próxima
      </button>
    </nav>
  );
}

export function OrganizationDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const query = useQuery({
    queryKey: ["backoffice", "organization", id],
    queryFn: () => unwrap(api.api.backoffice.organizations({ id }).get()),
  });

  if (!query.data) return <p className="muted">Carregando…</p>;

  const org = query.data;

  return (
    <section>
      <button type="button" onClick={onBack}>
        ← Empresas
      </button>
      <h2>{org.name}</h2>
      <p className="muted">
        {org.slug} · criada em {formatDay(org.createdAt)} · {org.caseCount} casos
      </p>
      <h3>Assinaturas</h3>
      <table>
        <thead>
          <tr>
            <th>Plano</th>
            <th>Preço mensal</th>
            <th>Status</th>
            <th>Período até</th>
          </tr>
        </thead>
        <tbody>
          {org.subscriptions.map((item) => (
            <tr key={item.id}>
              <td>{item.plan.name}</td>
              <td>{formatBRL(item.plan.monthlyPriceCents)}</td>
              <td>{item.status}</td>
              <td>{formatDay(item.currentPeriodEnd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Faturas recentes</h3>
      <table>
        <thead>
          <tr>
            <th>Vencimento</th>
            <th>Valor</th>
            <th>Status</th>
            <th>Pago em</th>
          </tr>
        </thead>
        <tbody>
          {org.invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>{formatDay(invoice.dueDate)}</td>
              <td>{formatBRL(invoice.amountCents)}</td>
              <td>{invoice.status}</td>
              <td>{formatDay(invoice.paidAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Usuários do portal</h3>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>E-mail</th>
            <th>Papel</th>
          </tr>
        </thead>
        <tbody>
          {org.members.map((member) => (
            <tr key={member.id}>
              <td>{member.name}</td>
              <td>{member.email}</td>
              <td>{member.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function TalentView() {
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ["backoffice", "talent", page],
    queryFn: () =>
      unwrap(
        api.api.backoffice.talent.get({ query: { limit: pageSize, offset: page * pageSize } }),
      ),
    placeholderData: keepPreviousData,
  });

  if (!query.data) return <p className="muted">Carregando…</p>;

  return (
    <section>
      <h2>Talentos</h2>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>E-mail</th>
            <th>Empresa de origem</th>
            <th>Primeiro acesso</th>
            <th>Assinatura</th>
            <th>Benefício</th>
          </tr>
        </thead>
        <tbody>
          {query.data.items.map((talent) => (
            <tr key={talent.id}>
              <td>{talent.name}</td>
              <td>{talent.email}</td>
              <td>{talent.orgName}</td>
              <td>{formatDay(talent.firstSignedInAt)}</td>
              <td>{talent.subscriptionStatus ?? "Sem assinatura"}</td>
              <td>
                {talent.benefitPlan ?? "Sem benefício"}
                {talent.benefitValidUntil ? ` até ${formatDay(talent.benefitValidUntil)}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={page} pages={pageCount(query.data.total, pageSize)} onChange={setPage} />
    </section>
  );
}

export function PlansView() {
  const query = useQuery({
    queryKey: ["backoffice", "plans"],
    queryFn: () => unwrap(api.api.backoffice.plans.get()),
  });

  if (!query.data) return <p className="muted">Carregando…</p>;

  return (
    <section>
      <h2>Planos</h2>
      <table>
        <thead>
          <tr>
            <th>Plano</th>
            <th>Preço mensal</th>
            <th>Máx. usuários</th>
            <th>Empresas ativas</th>
            <th>Talentos com benefício</th>
          </tr>
        </thead>
        <tbody>
          {query.data.map((plan) => (
            <tr key={plan.id}>
              <td>{plan.name}</td>
              <td>{formatBRL(plan.monthlyPriceCents)}</td>
              <td>{plan.maxEmployees}</td>
              <td>{plan.activeOrganizations}</td>
              <td>{plan.assignedTalent}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
