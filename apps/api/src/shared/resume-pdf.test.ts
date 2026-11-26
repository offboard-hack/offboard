import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderLetterPdf, renderResumePdf, type PdfResume } from "./resume-pdf.js";

const windows1252 = new TextDecoder("windows-1252");

const resume: PdfResume = {
  name: "Marina Lopes",
  headline: "Engenheira de Software",
  summary: "Dez anos\nde backend.",
  experiences: [
    {
      company: "Acme",
      role: "Engenheira",
      start: "2019-03",
      end: null,
      bullets: ["Liderou a migração", "Mentorou o time"],
    },
    { company: "Beta", role: "Estagiária", start: "2017-01", end: "2018-12", bullets: [] },
  ],
  education: [
    { institution: "USP", degree: "Computação", start: "2010", end: "2014" },
    { institution: "Coursera", degree: "Machine Learning", start: null, end: null },
    { institution: "", degree: "", start: null, end: null },
  ],
  skills: ["TypeScript", "PostgreSQL"],
  languages: [
    { name: "Inglês", level: "Fluente" },
    { name: "Espanhol", level: null },
  ],
  contact: { email: "marina@example.com", links: ["https://marina.dev"] },
};

async function drawnPages(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);

  return document.getPages().map((page) => {
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [];

    return refs.flatMap((ref) => {
      const stream = document.context.lookup(ref);
      const source = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : [];

      return Array.from(
        windows1252.decode(new Uint8Array(source)).matchAll(/<([0-9A-F]*)> Tj/g),
        ([, hex]) =>
          windows1252.decode(
            Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16)),
          ),
      );
    });
  });
}

async function drawnLines(bytes: Uint8Array) {
  return (await drawnPages(bytes)).flat();
}

describe("renderResumePdf", () => {
  it("draws the résumé sections in order", async () => {
    const bytes = await renderResumePdf(resume);

    expect(windows1252.decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(await drawnLines(bytes)).toEqual([
      "Marina Lopes",
      "Engenheira de Software",
      "Resumo",
      "Dez anos de backend.",
      "Experiência",
      "Engenheira — Acme",
      "2019-03 – Atual",
      "• Liderou a migração",
      "• Mentorou o time",
      "Estagiária — Beta",
      "2017-01 – 2018-12",
      "Formação",
      "Computação — USP",
      "2010 – 2014",
      "Machine Learning — Coursera",
      "Competências",
      "TypeScript, PostgreSQL",
      "Idiomas",
      "Inglês — Fluente",
      "Espanhol",
      "Contato",
      "marina@example.com",
      "https://marina.dev",
    ]);
  });

  it("draws the phone and city only when given", async () => {
    const phone = "+55 11 99999-0000";
    const city = "Campinas";

    const personal = await drawnLines(
      await renderResumePdf({ ...resume, contact: { ...resume.contact, phone, city } }),
    );

    const cleared = await drawnLines(
      await renderResumePdf({ ...resume, contact: { ...resume.contact, phone: null, city: null } }),
    );

    const withheld = (await drawnLines(await renderResumePdf(resume))).join(" ");

    expect(personal).toContain(phone);
    expect(personal).toContain(city);
    expect(cleared.join(" ")).not.toContain("99999");
    expect(cleared.join(" ")).not.toContain(city);
    expect(withheld).not.toContain("99999");
    expect(withheld).not.toContain(city);
  });

  it("omits empty sections", async () => {
    const bytes = await renderResumePdf({
      name: "Marina Lopes",
      headline: " ",
      summary: "",
      experiences: [],
      education: [],
      skills: [],
      languages: [],
      contact: { email: null, links: [] },
    });

    expect(await drawnLines(bytes)).toEqual(["Marina Lopes"]);
  });

  it("paginates long résumés", async () => {
    const bullets = Array.from({ length: 60 }, (_, index) => `Entrega número ${index + 1}`);

    const bytes = await renderResumePdf({
      ...resume,
      experiences: [{ company: "Acme", role: "Engenheira", start: "2019-03", end: null, bullets }],
    });

    const pages = await drawnPages(bytes);

    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.flat().filter((line) => line.startsWith("• "))).toEqual(
      bullets.map((bullet) => `• ${bullet}`),
    );
  });

  it("wraps long text and breaks words wider than the line", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const sentence = Array.from({ length: 40 }, () => "palavra").join(" ");
    const word = "x".repeat(300);

    const lines = await drawnLines(
      await renderResumePdf({ ...resume, summary: `${sentence} ${word}` }),
    );

    const summary = lines.slice(lines.indexOf("Resumo") + 1, lines.indexOf("Experiência"));

    expect(summary.length).toBeGreaterThan(3);
    expect(summary.join(" ").replaceAll(/(?<=x) (?=x)/g, "")).toBe(`${sentence} ${word}`);
    expect(summary.every((line) => font.widthOfTextAtSize(line, 10) <= 495.28)).toBe(true);
  });

  it("wraps kerned text exactly like measuring each whole line", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const words = ["AV", "To", "Ty", "WA", "Yo", "LT", "P.", "r,", "Vovó", "T", "A", "y"];
    const text = Array.from({ length: 400 }, (_, index) => words[(index * 7) % words.length]);
    const expected: string[] = [];

    for (const word of text) {
      const last = expected.at(-1);

      if (last !== undefined && font.widthOfTextAtSize(`${last} ${word}`, 10) <= 495.28) {
        expected[expected.length - 1] = `${last} ${word}`;
      } else expected.push(word);
    }

    const lines = await drawnLines(await renderResumePdf({ ...resume, summary: text.join(" ") }));

    expect(lines.slice(lines.indexOf("Resumo") + 1, lines.indexOf("Experiência"))).toEqual(
      expected,
    );
  });

  it("renders a résumé made of 2 000-character tokens quickly", async () => {
    const token = (letter: string) => letter.repeat(2000);
    const started = performance.now();

    const bytes = await renderResumePdf({
      name: token("N"),
      headline: token("h"),
      summary: token("s"),
      experiences: [
        {
          company: token("c"),
          role: token("r"),
          start: token("1"),
          end: token("2"),
          bullets: [token("b")],
        },
      ],
      education: [
        { institution: token("i"), degree: token("d"), start: token("3"), end: token("4") },
      ],
      skills: [token("k")],
      languages: [{ name: token("l"), level: token("v") }],
      contact: { email: token("e"), phone: token("p"), city: token("y"), links: [token("u")] },
    });

    expect(performance.now() - started).toBeLessThan(1500);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it("replaces characters outside WinAnsi", async () => {
    const lines = await drawnLines(
      await renderResumePdf({
        ...resume,
        headline: "Olá 😀 世界 \ud800 José fim",
      }),
    );

    expect(lines[1]).toBe("Olá ? ?? ? José fim");
  });
});

describe("renderLetterPdf", () => {
  it("draws the name and each paragraph of the letter on one page", async () => {
    const bytes = await renderLetterPdf(
      "Marina Lopes",
      "Olá, time.\n\nQuero  trabalhar\ncom vocês.\n \n",
    );

    expect(windows1252.decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(await drawnPages(bytes)).toEqual([
      ["Marina Lopes", "Olá, time.", "Quero trabalhar com vocês."],
    ]);
  });
});
