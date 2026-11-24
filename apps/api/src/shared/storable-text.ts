const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export const sanitizeText = (value: string) =>
  value.replaceAll("\u0000", "").replace(loneSurrogate, "�");

export const clipText = (value: string, limit: number) =>
  value.slice(0, limit).replace(/[\uD800-\uDBFF]$/, "");

export const storableClip = (value: string, limit: number) =>
  clipText(sanitizeText(value).trim(), limit).trim();

export const storableText = (value: string) => storableClip(value, 2_000);
