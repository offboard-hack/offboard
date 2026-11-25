import { Unzip, UnzipInflate } from "fflate";

export type ResumeFile =
  | { kind: "pdf"; data: Uint8Array }
  | { kind: "docx"; data: Uint8Array; text: string };

const documentEntry = "word/document.xml";
const xmlLimit = 2_000_000;
const sliceSize = 4_096;
const entryLimit = 1_000;

const pdfSignature = [0x25, 0x50, 0x44, 0x46, 0x2d];
const zipSignature = [0x50, 0x4b, 0x03, 0x04];

const markup =
  /<\/w:p>|<w:p(?:\s[^<>]*)?\/>|<w:tab\s*\/>|<w:(?:br|cr)(?:\s[^<>]*)?\/>|<w:t(?:\s[^<>]*)?>([^<]*)<\/w:t>/g;

const entity = /&(amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-fA-F]{1,6});/g;

const namedEntities = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

type Inflation = {
  status: "missing" | "reading" | "done" | "too_large" | "invalid";
  entries: number;
  size: number;
  xml: string;
};

function startsWith(data: Uint8Array, signature: number[]) {
  return signature.every((byte, index) => data[index] === byte);
}

function character(reference: string) {
  const code = reference.startsWith("#x")
    ? Number.parseInt(reference.slice(2), 16)
    : Number(reference.slice(1));

  return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
    ? String.fromCodePoint(code)
    : "�";
}

function decodeEntities(value: string) {
  return value.replace(
    entity,
    (_, reference: string) => namedEntities.get(reference) ?? character(reference),
  );
}

function documentText(xml: string) {
  return Array.from(xml.matchAll(markup), ([token, content]) => {
    if (content !== undefined) return decodeEntities(content);

    return token.startsWith("<w:tab") ? "\t" : "\n";
  })
    .join("")
    .trim();
}

function inflateDocument(data: Uint8Array) {
  const inflation: Inflation = { status: "missing", entries: 0, size: 0, xml: "" };
  const decoder = new TextDecoder();

  const unzip = new Unzip((file) => {
    inflation.entries += 1;

    if (inflation.entries > entryLimit && inflation.status === "missing") {
      inflation.status = "invalid";
    }

    if (file.name !== documentEntry || inflation.status !== "missing") return;

    inflation.status = "reading";

    file.ondata = (error, chunk, final) => {
      if (error) {
        inflation.status = "invalid";

        return;
      }

      inflation.size += chunk.length;

      if (inflation.size > xmlLimit) {
        inflation.status = "too_large";

        return;
      }

      inflation.xml += decoder.decode(chunk, { stream: !final });

      if (final) inflation.status = "done";
    };

    file.start();
  });

  unzip.register(UnzipInflate);

  for (
    let offset = 0;
    offset < data.length && (inflation.status === "missing" || inflation.status === "reading");
    offset += sliceSize
  ) {
    unzip.push(data.subarray(offset, offset + sliceSize), offset + sliceSize >= data.length);
  }

  return inflation;
}

function readDocx(data: Uint8Array) {
  try {
    const inflation = inflateDocument(data);

    if (inflation.status === "too_large") return "too_large" as const;

    if (inflation.status !== "done") return "unsupported" as const;

    return { kind: "docx" as const, data, text: documentText(inflation.xml) };
  } catch {
    return "unsupported" as const;
  }
}

export function readResumeFile(data: Uint8Array) {
  if (startsWith(data, pdfSignature)) return { kind: "pdf" as const, data };

  if (startsWith(data, zipSignature)) return readDocx(data);

  return "unsupported";
}
