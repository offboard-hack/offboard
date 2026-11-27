export class Unauthorized extends Error {}

export function isUnauthorized(error: Error) {
  return error instanceof Unauthorized;
}
