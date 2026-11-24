import { employeeAccessSchema, employeePlanSchema } from "@offboard/employee";
import { useForm } from "@tanstack/react-form";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { getApiClient } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/shadcn/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/shadcn/card";
import { Input } from "@/shared/ui/shadcn/input";

function accessQuery(caseId: string) {
  return queryOptions({
    queryKey: ["employee-access", caseId],
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const result = await getApiClient()
        .api["employee-access"]({ caseId })
        .get({ fetch: { signal } });

      if (result.error) throw new Error("Não foi possível abrir o acesso do colaborador.");

      return result.data;
    },
  });
}

export function EmployeeAccessSettings({ caseId }: { caseId: string }) {
  const query = useQuery(accessQuery(caseId));
  const [editorVersion, setEditorVersion] = useState(0);

  return (
    <Card size="sm">
      <CardHeader>
        <h2 className="text-base font-extrabold">Área do colaborador</h2>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <p role="status">Carregando acesso…</p>
        ) : !query.data ? (
          <div className="grid gap-3">
            <p role="alert" className="text-destructive">
              {query.error?.message}
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <details>
            <summary className="cursor-pointer font-bold text-primary">
              Configurar acesso e informações
            </summary>
            <AccessForm
              key={`${caseId}:${editorVersion}`}
              caseId={caseId}
              settings={query.data}
              reloading={query.isFetching}
              reloadFailed={query.isRefetchError}
              reload={async () => {
                const result = await query.refetch();

                if (result.isSuccess) setEditorVersion((version) => version + 1);
              }}
            />
          </details>
        )}
      </CardContent>
    </Card>
  );
}

const optionalDate = z.iso.date().or(z.literal(""));
const shortText = z.string().trim().max(255);
const entry = z.string().trim().min(1).max(255);

function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function columns(line: string) {
  return line.split("|").map((column) => column.trim());
}

const equipmentLine = z.tuple([entry, entry, z.string().max(200)]);
const handoffLine = z.tuple([entry, entry, entry, entry]);

const jobLine = z.tuple([
  entry.max(100),
  entry.max(200),
  entry.max(200),
  z.enum(["remoto", "híbrido"]),
  z.string().max(1200),
]);

const jobMode = { remoto: "remote", híbrido: "hybrid" } as const;

function listedValues<T>(schema: z.ZodType<T>, message: string) {
  return z
    .string()
    .max(16000)
    .refine(
      (value) =>
        lines(value).length <= 30 &&
        lines(value).every((line) => schema.safeParse(columns(line)).success),
      message,
    );
}

const settingsSchema = z
  .object({
    email: z
      .string()
      .trim()
      .pipe(z.email("Informe um e-mail válido.").or(z.literal(""))),
    company: shortText,
    officeAddress: z.string().trim().max(350),
    lastDay: optionalDate,
    clinic: shortText,
    clinicAddress: z.string().trim().max(350),
    examDay: optionalDate,
    examTime: z.iso.time({ precision: -1 }).or(z.literal("")),
    bookingDays: z
      .string()
      .max(400)
      .refine(
        (value) =>
          lines(value).length <= 31 &&
          lines(value).every((day) => z.iso.date().safeParse(day).success),
        "Informe até 31 datas no formato AAAA-MM-DD.",
      ),
    equipment: listedValues(
      equipmentLine,
      "Use uma linha por item, no formato patrimônio | equipamento | modelo.",
    ),
    handoff: listedValues(
      handoffLine,
      "Use uma linha por item, no formato código | tarefa | responsável | área.",
    ),
    jobs: listedValues(
      jobLine,
      "Use uma linha por vaga, no formato código | título | empresa | remoto ou híbrido | descrição.",
    ),
  })
  .superRefine((value, context) => {
    const exam = [value.clinic, value.clinicAddress, value.examDay, value.examTime];

    if (exam.some(Boolean) && !exam.every(Boolean)) {
      context.addIssue({
        code: "custom",
        path: ["examDay"],
        message: "Preencha data, horário, clínica e endereço do exame.",
      });
    }

    for (const key of ["equipment", "handoff", "jobs"] as const) {
      const identifiers = lines(value[key]).map((line) => columns(line)[0]);

      if (new Set(identifiers).size !== identifiers.length) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Use um código diferente para cada linha.",
        });
      }
    }
  });

const fields = [
  { key: "email", label: "E-mail para acesso", type: "email" },
  { key: "company", label: "Empresa", type: "text" },
  { key: "lastDay", label: "Último dia de trabalho", type: "date" },
  { key: "officeAddress", label: "Endereço para devolver equipamentos", type: "text" },
  { key: "examDay", label: "Data do exame", type: "date" },
  { key: "examTime", label: "Horário do exame", type: "time" },
  { key: "clinic", label: "Clínica", type: "text" },
  { key: "clinicAddress", label: "Endereço da clínica", type: "text" },
] as const;

const lists = [
  {
    key: "bookingDays",
    label: "Datas de devolução",
    hint: "Uma data por linha no formato AAAA-MM-DD.",
  },
  {
    key: "equipment",
    label: "Equipamentos",
    hint: "Uma linha por item. Patrimônio | Equipamento | Modelo",
  },
  {
    key: "handoff",
    label: "Itens da passagem",
    hint: "Uma linha por tarefa. Código | Tarefa | Responsável | Área",
  },
  {
    key: "jobs",
    label: "Vagas",
    hint: "Uma linha por vaga. Código | Título | Empresa | remoto ou híbrido | Descrição",
  },
] as const;

const settingsConflict = z.object({ code: z.literal("settings-changed") });

class EmployeeSettingsChanged extends Error {
  constructor() {
    super("O acesso mudou enquanto você editava. Confira a versão atual antes de salvar.");
  }
}

function AccessForm({
  caseId,
  settings,
  reload,
  reloading,
  reloadFailed,
}: {
  caseId: string;
  settings: z.infer<typeof employeeAccessSchema>;
  reload: () => Promise<void>;
  reloading: boolean;
  reloadFailed: boolean;
}) {
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = useState(settings);
  const { plan } = baseline;

  const write = useMutation({
    async mutationFn(next: z.infer<typeof employeeAccessSchema>) {
      const result = await getApiClient().api["employee-access"]({ caseId }).put(next);

      if (result.status === 409) {
        if (settingsConflict.safeParse(result.error?.value).success) {
          throw new EmployeeSettingsChanged();
        }

        throw new Error("Este e-mail já está vinculado a outro desligamento.");
      }

      if (result.error) throw new Error("Não foi possível salvar o acesso do colaborador.");

      return result.data;
    },
    onSuccess(value) {
      queryClient.setQueryData(accessQuery(caseId).queryKey, value);
      setBaseline(value);
      form.reset(form.state.values);
    },
  });

  const form = useForm({
    defaultValues: {
      email: baseline.email ?? "",
      company: plan.company ?? "",
      lastDay: plan.lastDay ?? "",
      officeAddress: plan.officeAddress ?? "",
      examDay: plan.exam?.day ?? "",
      examTime: plan.exam?.time ?? "",
      clinic: plan.exam?.clinic ?? "",
      clinicAddress: plan.exam?.address ?? "",
      bookingDays: plan.bookingDays.join("\n"),
      equipment: plan.equipment
        .map(({ code, title, model }) => [code, title, model].join(" | "))
        .join("\n"),
      handoff: plan.handoff
        .map(({ id, title, owner, area }) => [id, title, owner, area].join(" | "))
        .join("\n"),
      jobs: plan.jobs
        .map(({ id, title, company, mode, description }) =>
          [id, title, company, mode === "remote" ? "remoto" : "híbrido", description].join(" | "),
        )
        .join("\n"),
    },
    validators: { onSubmit: settingsSchema },
    onSubmit: ({ value }) => {
      const parsed = settingsSchema.parse(value);

      const nextPlan = employeePlanSchema.parse({
        company: parsed.company || null,
        officeAddress: parsed.officeAddress || null,
        lastDay: parsed.lastDay || null,
        exam: parsed.examDay
          ? {
              day: parsed.examDay,
              time: parsed.examTime,
              clinic: parsed.clinic,
              address: parsed.clinicAddress,
            }
          : null,
        bookingDays: [...new Set(lines(parsed.bookingDays))].sort(),
        equipment: lines(parsed.equipment).map((line) => {
          const [code, title, model] = equipmentLine.parse(columns(line));

          return { code, title, model };
        }),
        handoff: lines(parsed.handoff).map((line) => {
          const [id, title, owner, area] = handoffLine.parse(columns(line));

          return { id, title, owner, area };
        }),
        jobs: lines(parsed.jobs).map((line) => {
          const [id, title, company, mode, description] = jobLine.parse(columns(line));
          const existing = plan.jobs.find((job) => job.id === id);

          return {
            color: "#7008e7",
            location: "",
            salary: "",
            source: "board",
            requirements: [],
            ...existing,
            id,
            title,
            company,
            mode: jobMode[mode],
            description,
          };
        }),
      });

      const next = employeeAccessSchema.parse({
        email: parsed.email || null,
        plan: nextPlan,
        revision: baseline.revision,
      });

      write.mutate(next);
    },
  });

  return (
    <form
      className="mt-4 grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-muted-foreground">
        O colaborador entra com um código por e-mail. Apagar o e-mail revoga o acesso.
      </p>
      {fields.map(({ key, label, type }) => (
        <form.Field key={key} name={key}>
          {(field) => (
            <div className="grid gap-1.5">
              <label className="font-bold" htmlFor={`case-employee-${key}`}>
                {label}
              </label>
              <Input
                id={`case-employee-${key}`}
                type={type}
                disabled={write.isPending}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              {field.state.meta.errors[0] ? (
                <p role="alert" className="text-destructive">
                  {field.state.meta.errors[0].message}
                </p>
              ) : null}
            </div>
          )}
        </form.Field>
      ))}
      {lists.map(({ key, label, hint }) => (
        <form.Field key={key} name={key}>
          {(field) => (
            <div className="grid gap-1.5">
              <label className="font-bold" htmlFor={`case-employee-${key}`}>
                {label}
              </label>
              <p id={`case-employee-${key}-hint`} className="text-xs text-muted-foreground">
                {hint}
              </p>
              <textarea
                id={`case-employee-${key}`}
                disabled={write.isPending}
                aria-describedby={`case-employee-${key}-hint`}
                className="min-h-20 w-full rounded-lg border bg-background px-2.5 py-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              {field.state.meta.errors[0] ? (
                <p role="alert" className="text-destructive">
                  {field.state.meta.errors[0].message}
                </p>
              ) : null}
            </div>
          )}
        </form.Field>
      ))}
      {write.error ? (
        <p role="alert" className="text-destructive">
          {write.error.message}
        </p>
      ) : null}
      {write.isSuccess ? <p role="status">Área do colaborador atualizada.</p> : null}
      {write.error instanceof EmployeeSettingsChanged ? (
        <div className="grid gap-2">
          {reloadFailed ? (
            <p role="alert" className="text-destructive">
              Não foi possível carregar a versão atual. Tente novamente.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={reloading}
            onClick={() => void reload()}
          >
            {reloading ? "Carregando…" : "Descartar rascunho e carregar versão atual"}
          </Button>
        </div>
      ) : (
        <Button type="submit" disabled={write.isPending}>
          {write.isPending ? "Salvando…" : "Salvar acesso"}
        </Button>
      )}
    </form>
  );
}
