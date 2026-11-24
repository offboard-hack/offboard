const maxLength = 40;
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

export async function suggestSlug(
  name: string,
  taken: (slug: string) => boolean | Promise<boolean>,
) {
  const base = baseSlug(name);
  let candidate = base;

  for (let attempt = 2; !isValidSlug(candidate) || (await taken(candidate)); attempt += 1) {
    const suffix = `-${attempt}`;

    candidate = `${truncate(base, maxLength - suffix.length)}${suffix}`;
  }

  return candidate;
}
