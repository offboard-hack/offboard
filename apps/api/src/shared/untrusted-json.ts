export const escapeUntrustedTags = (json: string, tags: string[]) =>
  json.replace(new RegExp(`<(?=/?\\s*(?:${tags.join("|")})\\b)`, "gi"), "\\u003c");
