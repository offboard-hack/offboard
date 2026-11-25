import SecurityCheckIcon from "@hugeicons/core-free-icons/SecurityCheckIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import type { EmployeeState } from "@offboard/employee";
import { Link, useHydrated } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { type EmployeeAccount, useEmployeeWrite } from "@/entities/employee";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/shadcn/alert";
import { Button } from "@/shared/ui/shadcn/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/shadcn/card";
import { EmployeeError, EmployeePanel } from "./ui";

type PrivacyChoice = {
  account: EmployeeAccount;
  state: Extract<EmployeeState, { key: "consent" }>;
};

const acceptanceText =
  "Ao aceitar, você concorda com os Termos de uso e confirma a leitura da Política de privacidade.";

export function PrivacyNotice({ account, state, visible }: PrivacyChoice & { visible: boolean }) {
  const [dismissed, setDismissed] = useState(false);

  if (!visible || dismissed) return null;

  return (
    <aside
      aria-labelledby="aviso-privacidade"
      className="sticky bottom-0 z-10 mt-auto ml-auto w-full max-w-md px-3 pb-3 sm:px-6 sm:pb-4"
    >
      <Card size="sm" className="gap-3 shadow-lg ring-0">
        <CardHeader className="gap-1">
          <h2 id="aviso-privacidade" className="text-base font-semibold">
            Termos e privacidade
          </h2>
          <p className="text-muted-foreground">
            {acceptanceText}{" "}
            <Link
              to="/colaborador"
              search={{ tela: "privacidade" }}
              className="font-medium text-primary underline underline-offset-4"
            >
              Ler os documentos
            </Link>
          </p>
        </CardHeader>
        <CardContent>
          <PrivacyActions account={account} state={state} onDismiss={() => setDismissed(true)} />
        </CardContent>
      </Card>
    </aside>
  );
}

function PrivacyActions({ account, state, onDismiss }: PrivacyChoice & { onDismiss?: () => void }) {
  const hydrated = useHydrated();
  const write = useEmployeeWrite(account);

  return (
    <div className="grid gap-2">
      <EmployeeError message={write.error?.message} />
      <div className={onDismiss ? "flex flex-wrap justify-end gap-2" : "flex"}>
        {onDismiss && (
          <Button type="button" variant="ghost" disabled={write.isPending} onClick={onDismiss}>
            Agora não
          </Button>
        )}
        <Button
          type="button"
          disabled={!hydrated || write.isPending}
          onClick={() => write.mutate({ ...state, value: { accepted: true } })}
        >
          {write.isPending ? "Salvando…" : "Aceitar"}
        </Button>
      </div>
    </div>
  );
}

export function Privacy({ account, state }: PrivacyChoice) {
  return (
    <div className="space-y-5">
      <Alert role="note">
        <HugeiconsIcon icon={SecurityCheckIcon} aria-hidden="true" />
        <AlertTitle>Dados vinculados à sua conta</AlertTitle>
        <AlertDescription>Seu progresso fica disponível no aplicativo e na web.</AlertDescription>
      </Alert>
      <EmployeePanel title="Termos e política">
        <div className="divide-y">
          <details className="py-3">
            <summary className="cursor-pointer font-bold">Termos de uso</summary>
            <p className="mt-2 text-muted-foreground">
              O Offboard reúne as informações disponibilizadas pelo RH sobre seu desligamento e
              ajuda a organizar seu currículo, feedback e candidaturas. Confirme diretamente com o
              RH os dados que ainda não estiverem disponíveis.
            </p>
          </details>
          <details className="py-3">
            <summary className="cursor-pointer font-bold">Política de privacidade</summary>
            <p className="mt-2 text-muted-foreground">
              Usamos o e-mail autorizado pelo RH para proteger seu acesso. Suas escolhas e
              alterações ficam vinculadas à sua conta. A prévia do currículo exige sua sessão, e
              você decide com quem compartilhar um PDF exportado.
            </p>
          </details>
        </div>
        {state.value.accepted ? (
          <p role="status" className="text-sm text-muted-foreground">
            Suas escolhas estão salvas na sua conta.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{acceptanceText}</p>
            <PrivacyActions account={account} state={state} />
          </>
        )}
      </EmployeePanel>
    </div>
  );
}

export function Profile({ account, signOut }: { account: EmployeeAccount; signOut: ReactNode }) {
  return (
    <div className="space-y-5">
      <EmployeePanel title={account.name}>
        <p className="text-muted-foreground wrap-anywhere">{account.email}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            render={<Link to="/colaborador" search={{ tela: "privacidade" }} />}
          >
            Privacidade
          </Button>
          {signOut}
        </div>
      </EmployeePanel>
    </div>
  );
}
