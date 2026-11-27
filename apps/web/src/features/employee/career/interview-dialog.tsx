import { useState } from "react";
import { type CareerApplication, useAddInterview } from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { DatePicker } from "@/shared/ui/date-picker";
import { PortalFilter } from "@/shared/ui/select";
import { Button } from "@/shared/ui/shadcn/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/shadcn/dialog";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import { Textarea } from "@/shared/ui/shadcn/textarea";
import { EmployeeError } from "../ui";
import {
  emptyInterviewDraft,
  type InterviewDraft,
  interviewInput,
  interviewMode,
  interviewModes,
  interviewProblems,
} from "./interview-form";

export function InterviewDialog({
  account,
  application,
  close,
}: {
  account: EmployeeAccount;
  application: Pick<CareerApplication, "id" | "job">;
  close: () => void;
}) {
  const [draft, setDraft] = useState<InterviewDraft>(emptyInterviewDraft);
  const [submitted, setSubmitted] = useState(false);
  const add = useAddInterview(account, application.id);
  const problems = submitted ? interviewProblems(draft) : {};

  const set = (change: Partial<InterviewDraft>) => {
    add.reset();
    setDraft((current) => ({ ...current, ...change }));
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Entrevista marcada</DialogTitle>
          <DialogDescription>
            {application.job.title} · {application.job.company}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);

            if (Object.keys(interviewProblems(draft)).length > 0) return;

            add.mutate(interviewInput(draft), { onSuccess: close });
          }}
        >
          <DialogBody className="grid gap-4">
            <div className="grid gap-2">
              <Label id="interview-date-label" htmlFor="interview-date">
                Dia
              </Label>
              <DatePicker
                id="interview-date"
                labelledBy="interview-date-label"
                value={draft.date}
                onChange={(date) => set({ date })}
                invalid={Boolean(problems.date)}
                describedBy={problems.date ? "interview-date-error" : undefined}
              />
              <EmployeeError id="interview-date-error" message={problems.date} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="interview-time">Horário</Label>
              <Input
                id="interview-time"
                type="time"
                className="min-h-11"
                value={draft.time}
                aria-invalid={Boolean(problems.time)}
                aria-describedby={problems.time ? "interview-time-error" : undefined}
                onChange={(event) => set({ time: event.target.value })}
              />
              <EmployeeError id="interview-time-error" message={problems.time} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="interview-mode">Formato</Label>
              <PortalFilter
                id="interview-mode"
                label="Formato"
                value={draft.mode}
                items={interviewModes.map(({ value, label }) => ({ value, label }))}
                onChange={(mode) => set({ mode: interviewMode(mode) })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="interview-with">Com quem</Label>
              <Input
                id="interview-with"
                className="min-h-11"
                value={draft.with}
                aria-invalid={Boolean(problems.with)}
                aria-describedby={problems.with ? "interview-with-error" : undefined}
                onChange={(event) => set({ with: event.target.value })}
              />
              <EmployeeError id="interview-with-error" message={problems.with} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="interview-notes">Observações</Label>
              <Textarea
                id="interview-notes"
                value={draft.notes}
                aria-invalid={Boolean(problems.notes)}
                aria-describedby={problems.notes ? "interview-notes-error" : undefined}
                onChange={(event) => set({ notes: event.target.value })}
              />
              <EmployeeError id="interview-notes-error" message={problems.notes} />
            </div>
            <EmployeeError message={add.error?.message} />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? "Salvando…" : "Registrar entrevista"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
