import { normalizeQuestion } from "@offboard/db/question";
import type { FormField, FormQuestion, QuestionKind } from "@offboard/db/schema";

const sensitiveTerms = [
  "deficiencias?",
  "pcd",
  "disabilit\\w*",
  "racas?",
  "cor",
  "etnias?",
  "etnic\\w*",
  "racial",
  "trans",
  "transg\\w*",
  "transexua\\w*",
  "religi\\w*",
  "autodeclar\\w*",
  "lgbt\\w*",
  "negr[oa]s?",
  "indigena",
  "neurodivergen\\w*",
  "race",
  "ethnicity",
  "generos?",
  "gender",
  "sexo",
  "orientacao sexual",
  "sexual orientation",
  "identidade de genero",
  "diversidade",
  "diversity",
  "consentimento",
  "consent",
  "acessibilidade",
  "accessibility",
  "adaptac\\w*",
  "acomodac\\w*",
  "accommodations?",
  "necessidades especiais",
  "pne",
  "deficientes?",
  "laudo",
  "saude",
  "health",
  "neurodivers\\w*",
];

const sensitivePattern = new RegExp(`(?<![a-z0-9])(?:${sensitiveTerms.join("|")})(?![a-z0-9])`);

const standardKinds = new Map<string, QuestionKind>([
  ["first_name", "first_name"],
  ["last_name", "last_name"],
  ["email", "email"],
  ["phone", "phone"],
  ["resume", "resume"],
  ["resume_text", "resume"],
  ["cover_letter", "cover_letter"],
  ["cover_letter_text", "cover_letter"],
  ["location", "city"],
]);

export const cityLabelPattern =
  /^(?!.*(?:natal|nascimento|relocat\w*|mudar|gostaria)).*(?:\bcidade\b|\blocalizacao|\blocation\b|onde (?:voce )?mora|\breside\b|\bresidencia\b)/;

const labelKinds: [RegExp, QuestionKind][] = [
  [/linkedin/, "linkedin"],
  [/e-?mail/, "custom"],
  [/website|portfolio|portifolio|site pessoal/, "website"],
  [/cpf/, "cpf"],
  [/data de nascimento|date of birth|dt\.? (?:de )?nascimento/, "birth_date"],
  [/^cep(?:[^a-z0-9]*)$/, "cep"],
  [/endereco|address/, "address"],
  [cityLabelPattern, "city"],
];

export const isSensitive = (label: string, section: FormQuestion["section"]) =>
  section === "compliance" ||
  section === "demographic" ||
  sensitivePattern.test(normalizeQuestion(label));

export const isHiddenQuestion = (question: FormQuestion) =>
  question.fields.length > 0 && question.fields.every((field) => field.type === "hidden");

export const detectKind = (label: string, first: FormField) => {
  const standard = standardKinds.get(first.name);

  if (first.type === "file") {
    return standard === "resume" || standard === "cover_letter" ? standard : "document";
  }

  if (standard !== undefined) return standard;

  if (first.type !== "text" && first.type !== "textarea") return "custom";

  const normalized = normalizeQuestion(label);
  const matched = labelKinds.find(([pattern]) => pattern.test(normalized));

  if (matched !== undefined) return matched[1];

  return "custom";
};
