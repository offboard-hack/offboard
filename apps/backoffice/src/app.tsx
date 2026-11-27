import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Unauthorized, isUnauthorized } from "./access";
import { api, signInWithCode, verifyCode } from "./api";
import { OrganizationDetail, OrganizationsView, PlansView, SummaryView, TalentView } from "./views";

const tabs = [
  { id: "summary", label: "Resumo" },
  { id: "organizations", label: "Empresas" },
  { id: "talent", label: "Talentos" },
  { id: "plans", label: "Planos" },
] as const;

type Tab = (typeof tabs)[number]["id"];

export function App() {
  const summary = useQuery({
    queryKey: ["backoffice", "summary"],
    queryFn: async () => {
      const { data, error, status } = await api.api.backoffice.summary.get();

      if (status === 401 || status === 403) throw new Unauthorized();

      if (error) throw error;

      return data;
    },
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (summary.isPending) return <p className="muted">Carregando…</p>;

  if (summary.error && isUnauthorized(summary.error))
    return <SignIn onSignedIn={() => void summary.refetch()} />;

  if (summary.error) return <p role="alert">Sem acesso ao backoffice.</p>;

  return <Shell />;
}

function Shell() {
  const [tab, setTab] = useState<Tab>("summary");
  const [orgId, setOrgId] = useState<string | null>(null);

  return (
    <div className="layout">
      <header>
        <strong>Offboard · Backoffice</strong>
        <nav aria-label="Seções">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => {
                setTab(item.id);
                setOrgId(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === "summary" ? <SummaryView /> : null}
        {tab === "organizations" && orgId === null ? <OrganizationsView onOpen={setOrgId} /> : null}
        {tab === "organizations" && orgId !== null ? (
          <OrganizationDetail id={orgId} onBack={() => setOrgId(null)} />
        ) : null}
        {tab === "talent" ? <TalentView /> : null}
        {tab === "plans" ? <PlansView /> : null}
      </main>
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const result = await signInWithCode(email);

    if (result.error) setError(result.error.message ?? "Não foi possível enviar o código.");
    else setSent(true);
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const result = await verifyCode(email, otp);

    if (result.error) setError(result.error.message ?? "Código inválido.");
    else onSignedIn();
  }

  return (
    <div className="signin">
      <h1>Backoffice</h1>
      {sent ? (
        <form onSubmit={submitCode}>
          <label>
            Código enviado para {email}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
            />
          </label>
          <button type="submit">Entrar</button>
        </form>
      ) : (
        <form onSubmit={requestCode}>
          <label>
            E-mail
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button type="submit">Enviar código</button>
        </form>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
