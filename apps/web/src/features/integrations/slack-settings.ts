import { z } from "zod";

export const slackTokenSchema = z
  .string()
  .trim()
  .regex(/^xoxb-[A-Za-z0-9-]+$/, "Cole o Bot User OAuth Token, que começa com xoxb-.");

const revoked = "Este token foi revogado. Reinstale o app no workspace e copie o novo token.";

const messages = new Map([
  ["invalid_auth", "O Slack não aceitou este token. Copie-o de novo em OAuth & Permissions."],
  ["account_inactive", revoked],
  ["token_revoked", revoked],
]);

export function slackErrorMessage(code: string | undefined) {
  return messages.get(code ?? "") ?? "Não foi possível falar com o Slack. Tente novamente.";
}
