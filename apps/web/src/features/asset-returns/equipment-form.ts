import { z } from "zod";
import type { EquipmentReturn } from "@/entities/equipment-returns";

export const returnMethods = [
  { value: "pickup", label: "Coleta em casa" },
  { value: "in_person", label: "Entrega no escritório" },
] as const;

const holderEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Informe um e-mail válido.").or(z.literal("")));

export const equipmentFormSchema = z.object({
  caseId: z.string(),
  email: holderEmail,
  item: z.string().trim().min(1, "Informe o item.").max(255, "Use até 255 caracteres."),
  tag: z
    .string()
    .trim()
    .min(1, "Informe o patrimônio.")
    .max(255, "Use até 255 caracteres.")
    .regex(/^\S+$/, "O patrimônio não pode ter espaços."),
  returnMethod: z.enum(["pickup", "in_person"], { error: "Escolha como o bem volta." }),
});

export const assignFormSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Informe o e-mail corporativo ou pessoal da pessoa.")),
});

export type EquipmentForm = z.output<typeof equipmentFormSchema>;

export function equipmentPayload({ caseId, email, ...fields }: EquipmentForm) {
  return { ...fields, caseId: caseId || undefined, email: caseId ? undefined : email || undefined };
}

export function equipmentDefaults(
  item?: Pick<EquipmentReturn, "caseId" | "title" | "code" | "method">,
) {
  if (!item) return { caseId: "", email: "", item: "", tag: "", returnMethod: "pickup" };

  return {
    caseId: item.caseId ?? "",
    email: "",
    item: item.title,
    tag: item.code,
    returnMethod: item.method === "office" ? "in_person" : "pickup",
  };
}

const messages = new Map([
  ["Asset tag already in use", "Este patrimônio já está cadastrado em outro bem."],
  ["Case not found", "Este desligamento não existe mais."],
  ["Equipment not found", "Este bem já foi removido."],
  [
    "Equipment comes from the employee plan",
    "Este bem vem do plano da pessoa. Altere-o no desligamento.",
  ],
  ["No offboarding case uses this e-mail", "Nenhum desligamento usa este e-mail."],
  [
    "More than one case uses this e-mail",
    "Mais de um desligamento usa este e-mail. Escolha o desligamento na lista.",
  ],
  ["Equipment already assigned", "Este bem já está vinculado a um desligamento."],
]);

export function equipmentErrorMessage(code: string | undefined) {
  return messages.get(code ?? "") ?? "Não foi possível salvar o bem. Tente novamente.";
}
