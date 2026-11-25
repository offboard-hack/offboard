const maxLength = 40;
const maxAttempts = 100;
const minLength = 3;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const reservedSlugs: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "entrar",
  "p",
  "public",
  "offboard",
  "www",
  "static",
  "assets",
  "me",
  "login",
  "logout",
  "help",
  "suporte",
]);

export function isValidSlug(slug: string) {
  return (
    slug.length >= minLength &&
    slug.length <= maxLength &&
    slugPattern.test(slug) &&
    !reservedSlugs.has(slug)
  );
}

function truncate(slug: string, length: number) {
  return slug.slice(0, length).replace(/-$/, "");
}

function baseSlug(name: string) {
  const slug = truncate(
    name
      .toLowerCase()
      .normalize("NFD")
      .replaceAll(/\p{M}/gu, "")
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, ""),
    maxLength,
  );

  return slug.length < minLength ? "curriculo" : slug;
}

function randomHex() {
  return Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function withSuffix(base: string, suffix: string) {
  return `${truncate(base, maxLength - suffix.length)}${suffix}`;
}

export async function suggestSlug(
  name: string,
  taken: (slug: string) => boolean | Promise<boolean>,
) {
  const base = baseSlug(name);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = attempt === 1 ? base : withSuffix(base, `-${attempt}`);

    if (isValidSlug(candidate) && !(await taken(candidate))) return candidate;
  }

  return withSuffix(base, `-${randomHex()}`);
}
