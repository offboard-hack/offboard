import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readGreenhouseForm } from "./greenhouse.js";
import { isSensitive } from "./questions.js";

const stone = readFileSync(new URL("./fixtures/greenhouse-stone.json", import.meta.url), "utf8");

const respond = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

const fetching = (...responses: Response[]) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });

    const next = responses.shift();

    if (next === undefined) throw new Error("unexpected fetch");

    return next;
  };

  return { calls, fetchImpl };
};

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const field = (name: string, type: string, values: Json[] = []) => ({ name, type, values });

const question = (label: string, required: boolean, ...fields: Json[]) => ({
  description: null,
  label,
  required,
  fields,
});

const read = async (job: Json) => {
  const { fetchImpl } = fetching(respond(JSON.stringify(job)));

  const result = await readGreenhouseForm(fetchImpl, "acme", "1");

  if ("error" in result) throw new Error(result.error);

  return result.questions;
};

describe("reads a Greenhouse form", () => {
  it("reads the Stone form", async () => {
    const { calls, fetchImpl } = fetching(respond(stone));

    const result = await readGreenhouseForm(fetchImpl, "stone", "8201530003");

    expect(calls[0]?.url).toBe(
      "https://boards-api.greenhouse.io/v1/boards/stone/jobs/8201530003?questions=true",
    );

    if ("error" in result) throw new Error(result.error);

    const byLabel = (start: string) => {
      const found = result.questions.find((item) => item.label.startsWith(start));

      if (found === undefined) throw new Error(start);

      return found;
    };

    expect(result.questions.map((item) => item.kind).slice(0, 8)).toEqual([
      "first_name",
      "last_name",
      "email",
      "phone",
      "resume",
      "cover_letter",
      "cpf",
      "address",
    ]);
    expect(byLabel("Currículo").fields.map((item) => item.type)).toEqual(["file", "textarea"]);
    expect(byLabel("Currículo").required).toBe(true);
    expect(byLabel("Carta").required).toBe(false);
    expect(byLabel("Qual é o seu CPF").label).toBe("Qual é o seu CPF? (Formato: XXX.XXX.XXX-XX)");
    expect(byLabel("Qual é o seu perfil do Linkedin").kind).toBe("linkedin");
    expect(byLabel("Você é uma pessoa com deficiência").sensitive).toBe(true);
    expect(byLabel("Consentimento").sensitive).toBe(true);
    expect(byLabel("Qual é o seu grau de escolaridade").sensitive).toBe(false);
    expect(byLabel("Qual é o seu grau de escolaridade").kind).toBe("custom");

    const education = byLabel("Qual é o seu grau de escolaridade");

    expect(education.fields[0]?.type).toBe("single_select");
    expect(education.fields[0]?.options[0]).toEqual({
      label: "Ensino fundamental incompleto",
      value: "173418875003",
    });
    expect(byLabel("Como você conheceu").fields[0]?.type).toBe("multi_select");
    expect(byLabel("Como você conheceu").id).toBe("question_35399738003[]");
    expect(result.questions.slice(-3).map((item) => [item.section, item.label])).toEqual([
      ["location", "Longitude"],
      ["location", "Latitude"],
      ["location", "Localização"],
    ]);
    expect(byLabel("Longitude").fields[0]?.type).toBe("hidden");
    expect(byLabel("Localização").kind).toBe("city");
    expect(byLabel("Você precisa de alguma adaptação de acessibilidade").sensitive).toBe(true);
    expect(byLabel("Você necessita de alguma adaptação ou recurso").sensitive).toBe(true);
  });

  it("detects the city only on text fields and keeps selects custom", async () => {
    const questions = await read({
      questions: [
        question("Cidade onde você mora", true, field("q1", "input_text")),
        question("Onde você reside?", true, field("q2", "textarea")),
        question("Localização", true, field("location", "input_text")),
        question("Cidade de nascimento", true, field("q3", "input_text")),
        question("LinkedIn", true, field("q4", "multi_value_single_select")),
        question("Cidade onde você mora", true, field("q5", "multi_value_single_select")),
        question("CPF", true, field("q6", "multi_value_multi_select")),
        question("Sua localização atual", true, field("q7", "input_text")),
        question("Relocalização", true, field("q8", "input_text")),
      ],
    });

    expect(questions.map((item) => item.kind)).toEqual([
      "city",
      "city",
      "city",
      "custom",
      "custom",
      "custom",
      "custom",
      "city",
      "custom",
    ]);
  });

  it("keeps relocation, birthplace and preference questions custom", async () => {
    const labels = [
      "Are you open to relocation?",
      "Cidade natal",
      "Disponibilidade para mudar de cidade?",
      "Em qual cidade gostaria de trabalhar?",
      "Cidade",
      "Localização (Cidade)",
      "Current location",
    ];

    const questions = await read({
      questions: [
        ...labels.map((label, index) => question(label, true, field(`q${index}`, "input_text"))),
        question("Localização", true, field("location", "input_text")),
      ],
    });

    expect(questions.map((item) => item.kind)).toEqual([
      "custom",
      "custom",
      "custom",
      "custom",
      "city",
      "city",
      "city",
      "city",
    ]);
  });

  it("keeps section order and marks compliance and demographic sensitive", async () => {
    const questions = await read({
      demographic_questions: {
        questions: [
          {
            id: 7,
            label: "<p>Qual a sua <b>cor</b> &amp; etnia</p>",
            required: false,
            type: "multi_value_multi_select",
            answer_options: [
              { id: 1, label: "Branca" },
              { id: 2, label: "Preta" },
            ],
          },
          {
            id: 8,
            label: "Seu estado civil",
            required: true,
            type: "multi_value_single_select",
            answer_options: [{ id: 3, label: "Solteira" }],
          },
        ],
      },
      compliance: [
        {
          type: "eeoc",
          questions: [question("Veteran status", true, field("veteran", "input_text"))],
        },
        { type: "other", questions: null },
      ],
      location_questions: [question("Localização", true, field("location", "input_text"))],
      questions: [question("Nome", true, field("first_name", "input_text"))],
    });

    expect(questions.map((item) => [item.id, item.section, item.sensitive])).toEqual([
      ["first_name", "questions", false],
      ["location", "location", false],
      ["veteran", "compliance", true],
      ["demographic:7", "demographic", true],
      ["demographic:8", "demographic", true],
    ]);
    expect(questions[3]).toMatchObject({
      label: "Qual a sua cor & etnia",
      kind: "custom",
      fields: [
        {
          name: "demographic:7",
          type: "multi_select",
          options: [
            { label: "Branca", value: "1" },
            { label: "Preta", value: "2" },
          ],
        },
      ],
    });
    expect(questions[4]?.fields[0]?.type).toBe("single_select");
  });

  it("routes an uploaded document to document", async () => {
    const questions = await read({
      questions: [
        question("Laudo médico (PDF)", true, field("question_9", "input_file")),
        question("Portfólio", false, field("q10", "input_text")),
        question("Seu site pessoal", false, field("q11", "input_text")),
        question("Data de nascimento", true, field("q12", "input_text")),
        question("CEP:", true, field("q13", "input_text")),
        question("CEP do seu endereço", true, field("q14", "input_text")),
        question("Home address", true, field("q15", "input_text")),
        question("Anything else", false),
      ],
    });

    expect(questions.map((item) => item.kind)).toEqual([
      "document",
      "website",
      "website",
      "birth_date",
      "cep",
      "address",
      "address",
    ]);
  });

  it("drops unknown field types unless the question is required", async () => {
    const questions = await read({
      questions: [
        question("Opcional", false, field("a", "input_date")),
        question("Obrigatória", true, field("b", "input_date")),
        question("Mista", true, field("c", "input_text"), field("d", "input_date")),
        question("Sem campos", true),
      ],
    });

    expect(questions.map((item) => [item.id, item.kind, item.fields.length])).toEqual([
      ["b", "document", 0],
      ["c", "custom", 1],
      ["questions:3", "document", 0],
    ]);
  });

  it("tolerates null values and answer options", async () => {
    const questions = await read({
      questions: [
        {
          label: "Escolha",
          required: false,
          fields: [{ name: "a", type: "textarea", values: null }],
        },
      ],
      location_questions: null,
      compliance: null,
      demographic_questions: {
        questions: [
          { id: "x", label: "Gênero", required: false, type: "multi_value_single_select" },
        ],
      },
    });

    expect(questions.map((item) => [item.id, item.fields[0]?.options])).toEqual([
      ["a", []],
      ["demographic:x", []],
    ]);
  });

  it("keeps fieldless required questions per section", async () => {
    const questions = await read({
      questions: [question("Opcional", false), question("Obrigatória", true)],
      location_questions: [question("Local", true)],
      compliance: [{ questions: [question("Aceite", true)] }],
    });

    expect(questions.map((item) => [item.id, item.section, item.kind, item.sensitive])).toEqual([
      ["questions:1", "questions", "document", false],
      ["location:0", "location", "document", false],
      ["compliance:0", "compliance", "document", true],
    ]);
  });

  it("tightens kind detection", async () => {
    const questions = await read({
      questions: [
        question("Qual seu endereço de e-mail?", true, field("q1", "input_text")),
        question("Email address", true, field("q2", "input_text")),
        question("Cidade de nascimento", true, field("q3", "input_text")),
        question("Ano de nascimento", true, field("q4", "input_text")),
        question("Dt. de nascimento", true, field("q5", "input_text")),
        question("Date of birth", true, field("q6", "input_text")),
        question("Endereço de e-mail", true, field("email", "input_text")),
      ],
    });

    expect(questions.map((item) => item.kind)).toEqual([
      "custom",
      "custom",
      "custom",
      "custom",
      "birth_date",
      "birth_date",
      "email",
    ]);
  });

  it("answers not_found for a missing job", async () => {
    const { fetchImpl } = fetching(respond("{}", 404));

    expect(await readGreenhouseForm(fetchImpl, "acme", "1")).toEqual({ error: "not_found" });
  });

  it("answers unreadable for everything else", async () => {
    const failures = [
      respond("oops", 500),
      respond("<html></html>"),
      respond("{}", 200),
      respond(JSON.stringify({ questions: [{ label: 1 }] })),
      new Response("x".repeat(20), { headers: { "content-length": "99999999" } }),
      new Response(new ReadableStream({ start: (controller) => controller.error(new Error("x")) })),
      new Response(new Uint8Array(3_000_000)),
      new Response(null),
    ];

    for (const failure of failures) {
      const { fetchImpl } = fetching(failure);

      expect(await readGreenhouseForm(fetchImpl, "acme", "1")).toEqual({ error: "unreadable" });
    }

    const failing = async () => {
      throw new Error("offline");
    };

    expect(await readGreenhouseForm(failing, "acme", "1")).toEqual({ error: "unreadable" });
  });
});

describe("file fields", () => {
  it("treats every upload except the résumé and the cover letter as a document", async () => {
    const questions = await read({
      questions: [
        question("Portfólio (PDF)", false, field("q1", "input_file")),
        question("Comprovante de endereço", true, field("q2", "input_file")),
        question("LinkedIn em PDF", false, field("q3", "input_file")),
        question(
          "Currículo",
          true,
          field("resume", "input_file"),
          field("resume_text", "textarea"),
        ),
        question("Carta", false, field("cover_letter", "input_file")),
      ],
    });

    expect(questions.map((item) => [item.kind, item.required])).toEqual([
      ["document", false],
      ["document", true],
      ["document", false],
      ["resume", true],
      ["cover_letter", false],
    ]);
  });
});

describe("isSensitive", () => {
  it("flags sensitive sections and labels", () => {
    expect(isSensitive("Qualquer", "compliance")).toBe(true);
    expect(isSensitive("Qualquer", "demographic")).toBe(true);
    expect(isSensitive("Você é PcD?", "questions")).toBe(true);
    expect(isSensitive("Qual sua raça/cor?", "questions")).toBe(true);
    expect(isSensitive("Sua cor", "questions")).toBe(true);
    expect(isSensitive("Orientação sexual", "questions")).toBe(true);
    expect(isSensitive("Gender identity", "questions")).toBe(true);
    expect(isSensitive("Do you consent?", "questions")).toBe(true);
    expect(isSensitive("Possui deficiências?", "questions")).toBe(true);
    expect(isSensitive("Você é uma pessoa trans?", "questions")).toBe(true);
    expect(isSensitive("Autodeclaração étnico-racial", "questions")).toBe(true);
    expect(isSensitive("Do you have any disabilities?", "questions")).toBe(true);
    expect(isSensitive("Você é LGBTQIA+?", "questions")).toBe(true);
    expect(isSensitive("Pessoa negra ou indígena?", "questions")).toBe(true);
    expect(isSensitive("Você é neurodivergente?", "questions")).toBe(true);
    expect(isSensitive("Você é uma pessoa transgênero?", "questions")).toBe(true);
    expect(isSensitive("Você é transexual?", "questions")).toBe(true);
    expect(isSensitive("Qual a sua religião?", "questions")).toBe(true);
    expect(isSensitive("Your religious beliefs", "questions")).toBe(true);
  });

  it("avoids substring false positives", () => {
    expect(isSensitive("Você é corretor de imóveis?", "questions")).toBe(false);
    expect(isSensitive("Transporte próprio?", "questions")).toBe(false);
    expect(isSensitive("Aceita transferência?", "questions")).toBe(false);
    expect(isSensitive("Experience with trace logging", "questions")).toBe(false);
    expect(isSensitive("Qual é o seu grau de escolaridade?", "questions")).toBe(false);
  });
});
