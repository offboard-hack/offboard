import type { AccountExport } from "@/entities/career";

export const confirmationWord = "APAGAR";

export const deletionWarning =
  "Isso apaga seu perfil, currículos, candidaturas e respostas salvas. Assinaturas pagas (Carreira Pro ou upgrade do benefício) são canceladas. Não dá para desfazer.";

export function canDelete(typed: string, pending: boolean) {
  return !pending && typed.trim() === confirmationWord;
}

export function exportFilename(now: Date) {
  return `offboard-dados-${now.toISOString().slice(0, 10)}.json`;
}

export function exportJson(data: AccountExport) {
  return JSON.stringify(data, null, 2);
}
