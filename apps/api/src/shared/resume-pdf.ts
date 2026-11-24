import { PDFDocument, StandardFonts } from "pdf-lib";

export type PdfResume = {
  name: string;
  headline: string;
  summary: string;
  experiences: {
    company: string;
    role: string;
    start: string;
    end: string | null;
    bullets: string[];
  }[];
  education: { institution: string; degree: string; start: string | null; end: string | null }[];
  skills: string[];
  languages: { name: string; level: string | null }[];
  contact: {
    email: string | null;
    phone?: string | null;
    city?: string | null;
    links: string[];
  };
};

type Block = { text: string; bold: boolean; size: number; indent: number; gap: number };

const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 50;
const leading = 1.35;
const bodySize = 10;

function body(text: string, gap: number) {
  return { text, bold: false, size: bodySize, indent: 0, gap } satisfies Block;
}

function heading(text: string, size: number, gap: number) {
  return { text, bold: true, size, indent: 0, gap } satisfies Block;
}

function joined(parts: (string | null)[], separator: string) {
  return parts.filter(Boolean).join(separator);
}

function section(title: string, blocks: Block[]) {
  const filled = blocks.filter((block) => block.text.trim() !== "");

  return filled.length === 0 ? [] : [heading(title, 11, 12), ...filled];
}

function blocks(resume: PdfResume) {
  return [
    { text: resume.name, bold: true, size: 20, indent: 0, gap: 0 },
    { text: resume.headline, bold: false, size: 12, indent: 0, gap: 2 },
    ...section("Resumo", [body(resume.summary, 0)]),
    ...section(
      "Experiência",
      resume.experiences.flatMap((experience) => [
        heading(joined([experience.role, experience.company], " — "), bodySize, 6),
        body(joined([experience.start, experience.end ?? "Atual"], " – "), 0),
        ...experience.bullets.map((bullet) => ({ ...body(`• ${bullet}`, 0), indent: 8 })),
      ]),
    ),
    ...section(
      "Formação",
      resume.education.flatMap((education) => [
        heading(joined([education.degree, education.institution], " — "), bodySize, 6),
        body(joined([education.start, education.end], " – "), 0),
      ]),
    ),
    ...section("Competências", [body(resume.skills.join(", "), 0)]),
    ...section(
      "Idiomas",
      resume.languages.map((language) => body(joined([language.name, language.level], " — "), 0)),
    ),
    ...section(
      "Contato",
      [
        resume.contact.email,
        resume.contact.phone,
        resume.contact.city,
        ...resume.contact.links,
      ].map((value) => body(value ?? "", 0)),
    ),
  ] satisfies Block[];
}

function pack(items: string[], separator: string, fits: (text: string) => boolean) {
  const packed: string[] = [];

  for (const item of items) {
    const last = packed.at(-1);
    const candidate = `${last}${separator}${item}`;

    if (last !== undefined && fits(candidate)) packed[packed.length - 1] = candidate;
    else packed.push(item);
  }

  return packed;
}

function lines(text: string, encodable: Set<string>, fits: (text: string) => boolean) {
  const words = (text.normalize("NFC").match(/\S+/g) ?? []).flatMap((word) => {
    const safe = Array.from(word, (char) => (encodable.has(char) ? char : "?")).join("");

    return fits(safe) ? [safe] : pack(Array.from(safe), "", fits);
  });

  return pack(words, " ", fits);
}

export async function renderResumePdf(resume: PdfResume) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const encodable = new Set(regular.getCharacterSet().map((code) => String.fromCodePoint(code)));
  let page = document.addPage([pageWidth, pageHeight]);
  let cursor = pageHeight - margin;

  for (const block of blocks(resume)) {
    const font = block.bold ? bold : regular;
    const height = block.size * leading;
    const width = pageWidth - 2 * margin - block.indent;
    const fits = (text: string) => font.widthOfTextAtSize(text, block.size) <= width;

    cursor -= block.gap;

    for (const line of lines(block.text, encodable, fits)) {
      if (cursor - height < margin) {
        page = document.addPage([pageWidth, pageHeight]);
        cursor = pageHeight - margin;
      }

      page.drawText(line, {
        x: margin + block.indent,
        y: cursor - block.size,
        size: block.size,
        font,
      });
      cursor -= height;
    }
  }

  return document.save();
}
