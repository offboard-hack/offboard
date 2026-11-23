import { timingSafeEqual } from "node:crypto";

export function matchesSecret(actual: string | null, expected: string | undefined) {
  if (!actual || !expected) return false;

  const left = Buffer.from(actual);
  const right = Buffer.from(expected);

  return left.length === right.length && timingSafeEqual(left, right);
}

export function hasBearer(request: Request, secret: string | undefined) {
  return secret && matchesSecret(request.headers.get("authorization"), `Bearer ${secret}`);
}
