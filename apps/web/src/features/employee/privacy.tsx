import SecurityCheckIcon from "@hugeicons/core-free-icons/SecurityCheckIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import type { EmployeeState } from "@offboard/employee";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod";
import { type EmployeeAccount, employeeJourneyQuery, useEmployeeWrite } from "@/entities/employee";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/shadcn/alert";
import { Checkbox } from "@/shared/ui/shadcn/checkbox";
import { Button } from "@/shared/ui/shadcn/button";
import { EmployeeError, EmployeePanel } from "./ui";

const consentForm = z.object({
  terms: z.boolean().refine((value) => value, "Aceite os Termos de uso para continuar."),
  privacy: z.boolean().refine((value) => value, "Confirme a leitura da Política de privacidade."),
});

export function Privacy({
  account,
  state,
  signOut,
}: {
  account: EmployeeAccount;
  state: Extract<EmployeeState, { key: "consent" }>;
  signOut: ReactNode;
}) {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const write = useEmployeeWrite(account);

  const form = useForm({
    defaultValues: { terms: false, privacy: false },
    validators: { onSubmit: consentForm },
    onSubmit: ({ value }) => {
      consentForm.parse(value);
      write.mutate(
        { ...state, value: { accepted: true } },
        {
          onSuccess: () =>
            void queryClient.invalidateQueries({
              queryKey: employeeJourneyQuery(account).queryKey,
            }),
        },
      );
    },
  });

  return (
    <div className="space-y-5">
      <Alert role="note">
        <HugeiconsIcon icon={SecurityCheckIcon} aria-hidden="true" />
        <AlertTitle>Dados vinculados à sua conta</AlertTitle>
        <AlertDescription>Seu progresso fica disponível no aplicativo e na web.</AlertDescription>
      </Alert>
      <EmployeePanel title="Antes de continuar">
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
          <form
            noValidate
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="terms">
              {(field) => (
                <div>
                  <label className="flex min-h-11 items-center gap-2">
                    <Checkbox
                      disabled={!hydrated || write.isPending}
                      checked={field.state.value}
                      onCheckedChange={field.handleChange}
                    />{" "}
                    Li e aceito os Termos de uso.
                  </label>
                  <EmployeeError message={field.state.meta.errors[0]?.message} />
                </div>
              )}
            </form.Field>
            <form.Field name="privacy">
              {(field) => (
                <div>
                  <label className="flex min-h-11 items-center gap-2">
                    <Checkbox
                      disabled={!hydrated || write.isPending}
                      checked={field.state.value}
                      onCheckedChange={field.handleChange}
                    />{" "}
                    Li a Política de privacidade.
                  </label>
                  <EmployeeError message={field.state.meta.errors[0]?.message} />
                </div>
              )}
            </form.Field>
            <EmployeeError message={write.error?.message} />
            <Button
              type="submit"
              className="justify-self-start"
              disabled={!hydrated || write.isPending}
            >
              {write.isPending ? "Salvando…" : "Salvar escolhas e continuar"}
            </Button>
          </form>
        )}
      </EmployeePanel>
      {!state.value.accepted ? signOut : null}
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
