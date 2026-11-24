import type { ResumeContent } from "@offboard/db/schema";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { describe, expect, expectTypeOf, it } from "vitest";
import { renderResumePdf, type PdfResume } from "../../shared/resume-pdf.js";
import { toPublicResume, type PublicResume } from "./public-view.js";

const content: ResumeContent = {
  headline: { id: "headline-id", text: "Engenheira de Software" },
  summary: { id: "summary-id", text: "Dez anos de backend." },
  experiences: [
    {
      id: "experience-id",
      company: "Acme",
      role: "Engenheira",
      start: "2019-03",
      end: null,
      bullets: [{ id: "bullet-id", text: "Liderou a migração" }],
    },
  ],
  education: [
    { id: "education-id", institution: "USP", degree: "Computação", start: null, end: "2014" },
  ],
  skills: [{ id: "skill-id", name: "TypeScript" }],
  languages: [{ id: "language-id", name: "Inglês", level: "Fluente" }],
  contact: {
    email: "marina@example.com",
    phone: "+55 11 99999-0000",
    city: "Campinas",
    links: ["https://marina.dev"],
  },
};

async function drawnText(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);
  const decoder = new TextDecoder("windows-1252");

  return document
    .getPages()
    .flatMap((page) => {
      const contents = page.node.Contents();

      return contents instanceof PDFArray ? contents.asArray() : [];
    })
    .map((ref) => {
      const stream = document.context.lookup(ref);

      return stream instanceof PDFRawStream
        ? decoder.decode(decodePDFRawStream(stream).decode())
        : "";
    })
    .join("");
}

function hex(text: string) {
  return Array.from(text, (char) =>
    char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"),
  ).join("");
}

describe("public view", () => {
  it("renders the public view without phone or city", () => {
    const view = toPublicResume("Marina Lopes", content);

    expect(view).toEqual({
      name: "Marina Lopes",
      headline: "Engenheira de Software",
      summary: "Dez anos de backend.",
      experiences: [
        {
          company: "Acme",
          role: "Engenheira",
          start: "2019-03",
          end: null,
          bullets: ["Liderou a migração"],
        },
      ],
      education: [{ institution: "USP", degree: "Computação", start: null, end: "2014" }],
      skills: ["TypeScript"],
      languages: [{ name: "Inglês", level: "Fluente" }],
      contact: { email: "marina@example.com", links: ["https://marina.dev"] },
    });

    const json = JSON.stringify(view);

    expect(json).not.toContain("99999");
    expect(json).not.toContain("Campinas");
    expect(json).not.toContain("phone");
    expect(json).not.toContain("city");
    expect(json).not.toMatch(/"id"|-id"/);
  });

  it("feeds the PDF without phone or city", async () => {
    const text = await drawnText(await renderResumePdf(toPublicResume("Marina Lopes", content)));

    expect(text).toContain(hex("marina@example.com"));
    expect(text).not.toContain(hex("99999"));
    expect(text).not.toContain(hex("Campinas"));
  });

  it("fits the PDF input", () => {
    expectTypeOf<PublicResume>().toExtend<PdfResume>();
  });
});
