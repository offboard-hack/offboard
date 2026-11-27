import { randomBytes } from "node:crypto";

export function checkoutAttempt() {
  return `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}
