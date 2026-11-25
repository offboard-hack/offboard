const maxChars = 30_000;

export const decodeEntities = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");

export const htmlToText = (html: string) =>
  decodeEntities(
    html.replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, " ").replace(/<[^>]*(?:>|$)/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
