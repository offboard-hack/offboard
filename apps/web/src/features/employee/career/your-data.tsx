import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useState } from "react";
import { useDeleteAccount, useExportAccountData } from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { notifySessionChange } from "@/shared/lib/session-change";
import { Button } from "@/shared/ui/shadcn/button";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import { employeeAuth } from "../auth";
import { EmployeeError, EmployeePanel } from "../ui";
import {
  canDelete,
  confirmationWord,
  deletionWarning,
  exportFilename,
  exportJson,
} from "./account-data";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");

  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function YourDataSection({ account }: { account: EmployeeAccount }) {
  return (
    <div className="space-y-5">
      <ExportPanel account={account} />
      <DeletePanel account={account} />
    </div>
  );
}

function ExportPanel({ account }: { account: EmployeeAccount }) {
  const exportData = useExportAccountData(account);

  return (
    <EmployeePanel
      title="Baixar meus dados"
      description="Um arquivo JSON com seu perfil, currículos, candidaturas e respostas salvas."
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={exportData.isPending}
          onClick={() =>
            exportData.mutate(undefined, {
              onSuccess: (data) => download(exportFilename(new Date()), exportJson(data)),
            })
          }
        >
          {exportData.isPending ? "Preparando…" : "Baixar meus dados"}
        </Button>
        <EmployeeError message={exportData.error?.message} />
      </div>
    </EmployeePanel>
  );
}

function DeletePanel({ account }: { account: EmployeeAccount }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const queryClient = useQueryClient();
  const remove = useDeleteAccount(account);
  const id = useId();
  const warningId = `${id}-warning`;
  const errorId = `${id}-error`;

  const focusOnMount = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);

  function cancel() {
    remove.reset();
    setTyped("");
    setConfirming(false);
  }

  function submit() {
    remove.mutate(undefined, {
      async onSuccess() {
        await employeeAuth.signOut().catch(() => undefined);

        queryClient.clear();
        notifySessionChange();
        window.location.replace("/colaborador/entrar?aviso=conta-apagada");
      },
    });
  }

  return (
    <EmployeePanel
      title="Apagar minha conta"
      description="Remove seus dados do Offboard de forma definitiva."
    >
      {confirming ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();

            if (canDelete(typed, remove.isPending)) submit();
          }}
        >
          <p id={warningId} className="text-sm text-destructive">
            {deletionWarning}
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-confirm`}>Digite {confirmationWord} para confirmar</Label>
            <Input
              id={`${id}-confirm`}
              ref={focusOnMount}
              value={typed}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={remove.isPending}
              aria-describedby={remove.error ? `${warningId} ${errorId}` : warningId}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="destructive"
              disabled={!canDelete(typed, remove.isPending)}
            >
              {remove.isPending ? "Apagando…" : "Apagar minha conta"}
            </Button>
            <Button type="button" variant="outline" disabled={remove.isPending} onClick={cancel}>
              Cancelar
            </Button>
          </div>
          <EmployeeError id={errorId} message={remove.error?.message} />
        </form>
      ) : (
        <div>
          <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
            Apagar minha conta
          </Button>
        </div>
      )}
    </EmployeePanel>
  );
}
