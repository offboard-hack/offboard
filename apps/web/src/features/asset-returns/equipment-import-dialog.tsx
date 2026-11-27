import { Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, useState } from "react";
import { EquipmentImportError, useImportEquipment } from "@/entities/equipment-returns";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/shadcn/dialog";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import {
  equipmentCsvTemplate,
  parseEquipmentCsv,
  withProblems,
  type EquipmentCsvRow,
} from "./equipment-csv";
import { returnMethods } from "./equipment-form";

const maxBytes = 1_000_000;

const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(equipmentCsvTemplate)}`;

const methodLabels = new Map<string, string>(
  returnMethods.map(({ value, label }) => [value, label]),
);

async function readFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".csv")) return { error: "Selecione um arquivo CSV." };

  if (file.size > maxBytes) return { error: "O arquivo deve ter até 1 MB." };

  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());

    return parseEquipmentCsv(content);
  } catch {
    return { error: "Não foi possível ler o arquivo. Salve o CSV em UTF-8 e tente novamente." };
  }
}

export function EquipmentImportDialog() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EquipmentCsvRow[]>([]);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(0);
  const save = useImportEquipment();
  const invalid = rows.filter((row) => row.kind === "invalid").length;

  function clear() {
    setRows([]);
    setError("");
    save.reset();
  }

  async function select(file: File | undefined) {
    clear();
    setImported(0);

    if (!file) return;

    const result = await readFile(file);

    if (result.error) setError(result.error);
    else setRows(result.rows ?? []);
  }

  function confirm() {
    const valid = rows.flatMap((row) =>
      row.kind === "valid"
        ? [{ person: row.person, item: row.item, tag: row.tag, returnMethod: row.returnMethod }]
        : [],
    );

    save.mutate(valid, {
      onSuccess: () => {
        setImported(valid.length);
        setRows([]);
      },
      onError: (failure) => {
        if (failure instanceof EquipmentImportError && failure.problems.length) {
          setRows(withProblems(rows, failure.problems));
          save.reset();
        }
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          clear();
          setImported(0);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <HugeiconsIcon icon={Upload01Icon} aria-hidden="true" />
        Importar CSV
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight font-semibold sm:text-2xl">
            Importar bens
          </DialogTitle>
          <DialogDescription>
            Use as colunas pessoa, item, patrimonio e devolucao. Em pessoa, informe o e-mail ou o
            nome do desligamento. Em devolucao, use coleta ou escritorio.{" "}
            <a
              href={templateHref}
              download="modelo-bens.csv"
              className="font-medium text-primary underline underline-offset-2"
            >
              Baixar modelo
            </a>
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-file`}>Arquivo CSV</Label>
            <Input
              id={`${id}-file`}
              type="file"
              accept=".csv,text/csv"
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => void select(event.currentTarget.files?.[0])}
            />
          </div>
          {error && (
            <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {imported > 0 && (
            <p role="status" className="text-sm">
              {imported === 1 ? "1 bem importado." : `${imported} bens importados.`}
            </p>
          )}
          {save.isError && (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível importar os bens. Tente novamente.
            </p>
          )}
          {rows.length > 0 && (
            <>
              <p role="status" className="text-sm text-muted-foreground">
                {invalid
                  ? `${invalid} de ${rows.length} linhas precisam de ajuste. Corrija o arquivo e selecione-o de novo.`
                  : `${rows.length} bens prontos para importar.`}
              </p>
              <div className="max-h-80 overflow-auto rounded-xl border">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Revisão da importação</caption>
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Linha</th>
                      <th className="px-3 py-2 font-medium">Pessoa</th>
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 font-medium">Patrimônio</th>
                      <th className="px-3 py-2 font-medium">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.record} className="border-t align-top">
                        <td className="px-3 py-2 tabular-nums">{row.record}</td>
                        <td className="px-3 py-2">{row.person}</td>
                        <td className="px-3 py-2">{row.item}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.tag}</td>
                        <td className="px-3 py-2">
                          {row.kind === "valid" ? (
                            <Badge variant="secondary">{methodLabels.get(row.returnMethod)}</Badge>
                          ) : (
                            <span className="text-destructive">{row.issue}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" className="min-h-11" />}>
            Fechar
          </DialogClose>
          <Button
            className="min-h-11"
            disabled={!rows.length || invalid > 0 || save.isPending}
            onClick={confirm}
          >
            {save.isPending ? "Importando…" : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
