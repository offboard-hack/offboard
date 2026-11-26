import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type CareerJob,
  type RejectionReason,
  rejectionsQuery,
  useRejectJob,
  useUndoRejection,
} from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { Button } from "@/shared/ui/shadcn/button";
import { Label } from "@/shared/ui/shadcn/label";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { Textarea } from "@/shared/ui/shadcn/textarea";
import { EmployeeEmpty, EmployeeError, EmployeePanel } from "../ui";
import { careerDate } from "./labels";
import { rejectionLabel, rejectionNote, rejectionReasons } from "./rejections";

export function DismissJob({
  account,
  job,
  cancel,
  done,
}: {
  account: EmployeeAccount;
  job: Pick<CareerJob, "id">;
  cancel: () => void;
  done: () => void;
}) {
  const [reason, setReason] = useState<RejectionReason | null>(null);
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const reject = useRejectJob(account);
  const read = rejectionNote(note);
  const problem = "problem" in read ? read.problem : undefined;

  return (
    <form
      className="grid gap-3 rounded-lg border p-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setChecked(true);

        if (reason === null || "problem" in read) return;

        reject.mutate({ jobId: job.id, reason, note: read.note }, { onSuccess: done });
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Por que esta vaga não serve?</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {rejectionReasons.map((option) => (
            <label key={option.value} className="flex min-h-9 items-center gap-2 text-sm">
              <input
                type="radio"
                name="rejection-reason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
        <EmployeeError message={checked && reason === null ? "Escolha um motivo." : undefined} />
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor="rejection-note">Comentário (opcional)</Label>
        <Textarea
          id="rejection-note"
          rows={2}
          value={note}
          aria-invalid={problem !== undefined}
          aria-describedby="rejection-note-error"
          onChange={(event) => setNote(event.target.value)}
        />
        <EmployeeError id="rejection-note-error" message={problem} />
      </div>
      <p className="text-xs text-muted-foreground">
        A vaga sai das suas listas. Você pode trazê-la de volta em Preferências.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={reject.isPending}>
          {reject.isPending ? "Dispensando…" : "Dispensar vaga"}
        </Button>
        <Button type="button" variant="outline" disabled={reject.isPending} onClick={cancel}>
          Voltar
        </Button>
      </div>
      <EmployeeError message={reject.error?.message} />
    </form>
  );
}

export function RejectionsSection({ account }: { account: EmployeeAccount }) {
  const rejections = useQuery(rejectionsQuery(account));
  const undo = useUndoRejection(account);

  if (rejections.error) return <EmployeeError message={rejections.error.message} />;

  if (!rejections.data) return <Skeleton className="h-24 w-full" aria-busy="true" />;

  const { items, reasons } = rejections.data;

  return (
    <EmployeePanel
      title="Vagas dispensadas"
      description="Vagas que você tirou das suas listas e o motivo."
    >
      {items.length === 0 ? (
        <EmployeeEmpty>
          Nenhuma vaga dispensada. Abra uma vaga e use “Não tenho interesse” para tirá-la da lista.
        </EmployeeEmpty>
      ) : (
        <>
          <ul aria-label="Motivos" className="flex flex-wrap gap-2 text-sm">
            {reasons.map((item) => (
              <li key={item.reason} className="rounded-md border px-2 py-1">
                {rejectionLabel(item.reason)} · {item.count}
              </li>
            ))}
          </ul>
          <ul className="grid gap-3">
            {items.map((item) => (
              <li
                key={item.job.id}
                className="flex flex-wrap items-start justify-between gap-2 border-t pt-3"
              >
                <div className="grid gap-0.5">
                  <p className="font-medium wrap-anywhere">{item.job.title}</p>
                  <p className="text-sm text-muted-foreground wrap-anywhere">
                    {item.job.company} · {rejectionLabel(item.reason)}
                    {item.createdAt ? ` · ${careerDate(item.createdAt)}` : ""}
                  </p>
                  {item.note ? <p className="text-sm wrap-anywhere">{item.note}</p> : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={undo.isPending}
                  onClick={() => undo.mutate(item.job.id)}
                >
                  Trazer de volta
                </Button>
              </li>
            ))}
          </ul>
          <EmployeeError message={undo.error?.message} />
        </>
      )}
    </EmployeePanel>
  );
}
