import { Zip, ZipDeflate, zipSync, type Zippable } from "fflate";
import { describe, expect, expectTypeOf, it } from "vitest";
import { readResumeFile, type ResumeFile } from "./document.js";

const encoder = new TextEncoder();

const namespace = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function body(content: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${namespace}><w:body>${content}</w:body></w:document>`;
}

function docx(xml: string, entries: Zippable = {}, level: 0 | 6 = 6) {
  return zipSync(
    {
      "word/document.xml": encoder.encode(xml),
      "[Content_Types].xml": encoder.encode("<Types/>"),
      ...entries,
    },
    { level },
  );
}

function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function streamedDocx(xml: string) {
  const parts: Uint8Array[] = [];

  const zip = new Zip((error, chunk) => {
    if (error) throw error;

    parts.push(chunk);
  });

  const entry = new ZipDeflate("word/document.xml");

  zip.add(entry);
  entry.push(encoder.encode(xml), true);
  zip.end();

  return concat(parts);
}

function replaceBytes(data: Uint8Array, from: string, to: string) {
  const search = encoder.encode(from);
  const replacement = encoder.encode(to);
  const result = data.slice();

  for (let index = 0; index <= result.length - search.length; index++) {
    if (search.every((byte, offset) => result[index + offset] === byte))
      result.set(replacement, index);
  }

  return result;
}

function dataOffset(zip: Uint8Array) {
  return 30 + zip[26] + zip[27] * 256 + zip[28] + zip[29] * 256;
}

const sample = body(
  [
    '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>',
    '<w:r><w:t>Ana</w:t></w:r><w:r><w:t xml:space="preserve"> Souza</w:t></w:r></w:p>',
    "<w:p><w:r><w:t>A&amp;B &lt;x&gt; &quot;q&quot; &apos;a&apos; &#233; &#xE9; &#0; &#xD800; &#1114112; &unknown; &#99999999;</w:t>",
    '<w:tab/><w:t>2020</w:t><w:br/><w:t>Linha</w:t><w:br w:type="page"/><w:t>Página</w:t></w:r></w:p>',
    "<w:p/>",
    "<w:tbl><w:tr><w:tc><w:p><w:r><w:delText>removido</w:delText><w:t>Célula</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
    '<w:p w:rsidR="00A1"><w:r><w:t></w:t><w:t>Fim</w:t></w:r></w:p>',
  ].join(""),
);

const sampleText = [
  "Ana Souza",
  "A&B <x> \"q\" 'a' é é � � � &unknown; &#99999999;\t2020",
  "Linha",
  "Página",
  "",
  "Célula",
  "Fim",
].join("\n");

const bomb = body(`<w:p><w:r><w:t>${"a".repeat(3_000_000)}</w:t></w:r></w:p>`);

describe("readResumeFile", () => {
  it("returns a resume file or a rejection", () => {
    expectTypeOf(readResumeFile).returns.toEqualTypeOf<ResumeFile | "unsupported" | "too_large">();
  });

  it("sniffs file types from bytes", () => {
    const pdf = encoder.encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

    expect(readResumeFile(pdf)).toEqual({ kind: "pdf", data: pdf });
    expect(readResumeFile(encoder.encode("<!doctype html><html><body>%PDF-</body></html>"))).toBe(
      "unsupported",
    );
    expect(readResumeFile(encoder.encode("MZ\x90\x00executable"))).toBe("unsupported");
    expect(readResumeFile(new Uint8Array())).toBe("unsupported");
    expect(readResumeFile(encoder.encode("PK\x03\x04"))).toBe("unsupported");
    expect(readResumeFile(zipSync({ "xl/workbook.xml": encoder.encode("<workbook/>") }))).toBe(
      "unsupported",
    );

    const file = docx(sample);

    expect(readResumeFile(file)).toEqual({ kind: "docx", data: file, text: sampleText });
  });

  it("reads stored and streamed archives", () => {
    expect(readResumeFile(docx(sample, {}, 0))).toMatchObject({ kind: "docx", text: sampleText });

    const streamed = streamedDocx(sample);

    expect(streamed[6] & 8).toBe(8);
    expect(readResumeFile(streamed)).toMatchObject({ kind: "docx", text: sampleText });
  });

  it("uses only the first document entry", () => {
    const duplicated = replaceBytes(
      docx(body("<w:p><w:r><w:t>Primeiro</w:t></w:r></w:p>"), {
        "word/document.xmm": encoder.encode(body("<w:p><w:r><w:t>Segundo</w:t></w:r></w:p>")),
      }),
      "word/document.xmm",
      "word/document.xml",
    );

    expect(readResumeFile(duplicated)).toMatchObject({ kind: "docx", text: "Primeiro" });
  });

  it("caps docx expansion", () => {
    const zip = docx(bomb);

    expect(zip.length).toBeLessThan(20_000);
    expect(readResumeFile(zip)).toBe("too_large");

    const lying = zip.slice();

    lying.set([16, 0, 0, 0], 22);
    expect(readResumeFile(lying)).toBe("too_large");
    expect(readResumeFile(docx(bomb, {}, 0))).toBe("too_large");
    expect(readResumeFile(streamedDocx(bomb))).toBe("too_large");
  });

  it("rejects corrupt archives", () => {
    const file = docx(sample);
    const corrupt = file.slice();

    corrupt[dataOffset(file)] = 0xff;
    expect(readResumeFile(corrupt)).toBe("unsupported");
    expect(readResumeFile(file.subarray(0, 120))).toBe("unsupported");

    const unknownMethod = docx(sample, {}, 0);

    unknownMethod.set([14, 0], 8);
    expect(readResumeFile(unknownMethod)).toBe("unsupported");
  });

  it("parses hostile markup in linear time", () => {
    const hostile = body(
      `${"<w:t <w:p <w:br ".repeat(120_000)}<w:p><w:r><w:t>Fim</w:t></w:r></w:p>`,
    );

    const started = performance.now();

    expect(readResumeFile(docx(hostile))).toMatchObject({ kind: "docx", text: "Fim" });
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
