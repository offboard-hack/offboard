import { normalizeQuestion } from "@offboard/db/question";
import type { FormField, FormQuestion, QuestionKind } from "@offboard/db/schema";

const sensitiveTerms = [
  "deficiencias?",
  "pcd",
  "disability",
  "racas?",
  "cor",
  "etnias?",
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
]);

const labelKinds: [RegExp, QuestionKind][] = [
  [/linkedin/, "linkedin"],
  [/website|portfolio|portifolio|site pessoal/, "website"],
  [/cpf/, "cpf"],
  [/data de nascimento|date of birth|nascimento/, "birth_date"],
  [/^cep(?:[^a-z0-9]*)$/, "cep"],
  [/endereco|address/, "address"],
];

export const isSensitive = (label: string, section: FormQuestion["section"]) =>
  section === "compliance" ||
  section === "demographic" ||
  sensitivePattern.test(normalizeQuestion(label));

export const detectKind = (label: string, first: FormField) => {
  const standard = standardKinds.get(first.name);

  if (standard !== undefined) return standard;

  const normalized = normalizeQuestion(label);
  const matched = labelKinds.find(([pattern]) => pattern.test(normalized));

  if (matched !== undefined) return matched[1];

  return first.type === "file" ? "document" : "custom";
};
