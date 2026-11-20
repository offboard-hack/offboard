const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readJson(req: Request) {
  return req.json().catch(() => null);
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}
