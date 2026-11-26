import type { CareerPreferences } from "@/entities/career";

type Fields = CareerPreferences["profileFields"];

export type TextKey = Exclude<keyof Fields, "address">;

type Address = NonNullable<Fields["address"]["value"]>;

export type AddressKey = keyof Address;

export type TextDraft = { value: string; share: boolean };

export type AddressDraft = Record<AddressKey, string> & { share: boolean };

export type ProfileDraft = Record<TextKey, TextDraft> & { address: AddressDraft };

export type ProfileChanges = Partial<Fields>;

const textLimit = 500;
const minimumAge = 14;

export const states = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

export const textFields = [
  { key: "phone", label: "Telefone", hint: "Com DDD, número do Brasil.", group: "personal" },
  { key: "city", label: "Cidade", hint: "Ex.: Porto Alegre, RS", group: "personal" },
  { key: "linkedin", label: "URL do LinkedIn", hint: null, group: "personal" },
  { key: "portfolio", label: "Site ou portfólio", hint: null, group: "personal" },
  { key: "cpf", label: "CPF", hint: null, group: "personal" },
  { key: "birthDate", label: "Data de nascimento", hint: "DD/MM/AAAA", group: "personal" },
  {
    key: "workAuthorization",
    label: "Autorização de trabalho",
    hint: "Ex.: cidadão brasileiro, não preciso de visto.",
    group: "work",
  },
  {
    key: "availability",
    label: "Disponibilidade para começar",
    hint: "Ex.: imediata",
    group: "work",
  },
  { key: "noticePeriod", label: "Aviso prévio", hint: "Ex.: 30 dias", group: "work" },
  {
    key: "salaryExpectation",
    label: "Pretensão salarial",
    hint: "Ex.: R$ 12.000 CLT",
    group: "work",
  },
] as const satisfies {
  key: TextKey;
  label: string;
  hint: string | null;
  group: "personal" | "work";
}[];

export const addressFields = [
  { key: "cep", label: "CEP", optional: false },
  { key: "street", label: "Rua", optional: false },
  { key: "number", label: "Número", optional: false },
  { key: "complement", label: "Complemento", optional: true },
  { key: "neighborhood", label: "Bairro", optional: false },
  { key: "city", label: "Cidade", optional: false },
  { key: "state", label: "Estado (UF)", optional: false },
] as const satisfies { key: AddressKey; label: string; optional: boolean }[];

const addressLimits: Record<AddressKey, number> = {
  cep: 9,
  street: 200,
  number: 20,
  complement: 100,
  neighborhood: 100,
  city: 100,
  state: 2,
};

const textKeys = textFields.map((field) => field.key);

const digitsOf = (text: string) => text.replace(/\D/g, "");

function checkDigit(digits: string, length: number) {
  let sum = 0;

  for (let index = 0; index < length; index++) {
    sum += Number(digits[index]) * (length + 1 - index);
  }

  const rest = (sum * 10) % 11;

  return rest === 10 ? 0 : rest;
}

export function isValidCpf(digits: string) {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;

  return (
    checkDigit(digits, 9) === Number(digits[9]) && checkDigit(digits, 10) === Number(digits[10])
  );
}

function shownCpf(digits: string) {
  return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

function shownDate(iso: string) {
  const [year, month, day] = iso.split("-");

  return `${day}/${month}/${year}`;
}

function isoDate(shown: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(shown.trim());

  return match === null ? null : `${match[3]}-${match[2]}-${match[1]}`;
}

function isRealDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function oldEnough(birthDate: string, today: string) {
  const [year, ...rest] = today.split("-");

  return birthDate <= [Number(year) - minimumAge, ...rest].join("-");
}

function shownText(key: TextKey, value: string | null) {
  if (value === null) return "";

  if (key === "cpf") return shownCpf(value);

  return key === "birthDate" ? shownDate(value) : value;
}

function storedText(key: TextKey, shown: string) {
  const value = shown.trim();

  if (value === "") return null;

  if (key === "cpf") return digitsOf(value);

  return key === "birthDate" ? isoDate(value) : value;
}

const newShare = (empty: boolean, share: boolean) => empty || share;

export function profileDraft(fields: Fields) {
  const text = (key: TextKey) => ({
    value: shownText(key, fields[key].value),
    share: newShare(fields[key].value === null, fields[key].share),
  });

  const address = fields.address.value;

  return {
    phone: text("phone"),
    city: text("city"),
    linkedin: text("linkedin"),
    portfolio: text("portfolio"),
    workAuthorization: text("workAuthorization"),
    availability: text("availability"),
    noticePeriod: text("noticePeriod"),
    salaryExpectation: text("salaryExpectation"),
    cpf: text("cpf"),
    birthDate: text("birthDate"),
    address: {
      cep: address === null ? "" : address.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2"),
      street: address?.street ?? "",
      number: address?.number ?? "",
      complement: address?.complement ?? "",
      neighborhood: address?.neighborhood ?? "",
      city: address?.city ?? "",
      state: address?.state ?? "",
      share: newShare(address === null, fields.address.share),
    },
  } satisfies ProfileDraft;
}

export function textProblem(key: TextKey, shown: string, today: string) {
  const value = shown.trim();

  if (value === "") return undefined;

  if (value.length > textLimit) return "Use até 500 caracteres.";

  if (key === "phone") {
    if (/^\+(?!55)/.test(value)) return "Use um número do Brasil.";

    const digits = digitsOf(value).replace(/^55(?=\d{10,11}$)/, "");

    return digits.length === 10 || digits.length === 11 ? undefined : "Informe o DDD e o número.";
  }

  if (key === "cpf") return isValidCpf(digitsOf(value)) ? undefined : "CPF inválido.";

  if (key !== "birthDate") return undefined;

  const iso = isoDate(value);

  if (iso === null || !isRealDate(iso) || iso < "1900-01-01") return "Use o formato DD/MM/AAAA.";

  return oldEnough(iso, today) ? undefined : "Confira a data de nascimento.";
}

export function addressProblem(address: AddressDraft) {
  const filled = addressFields.filter(({ key }) => address[key].trim() !== "");

  if (filled.length === 0) return undefined;

  const missing = addressFields.find(
    ({ key, optional }) => !optional && address[key].trim() === "",
  );

  if (missing !== undefined) return `Preencha ${missing.label.toLowerCase()} ou apague o endereço.`;

  const long = addressFields.find(({ key }) => address[key].trim().length > addressLimits[key]);

  if (long !== undefined) return `${long.label} está longo demais.`;

  if (!/^\d{5}-?\d{3}$/.test(address.cep.trim())) return "Use o CEP no formato 00000-000.";

  return states.includes(address.state.trim().toUpperCase())
    ? undefined
    : "Use a sigla do estado, como RS.";
}

function storedAddress(address: AddressDraft) {
  if (addressFields.every(({ key }) => address[key].trim() === "")) return null;

  const complement = address.complement.trim();

  return {
    cep: digitsOf(address.cep),
    street: address.street.trim(),
    number: address.number.trim(),
    complement: complement === "" ? null : complement,
    neighborhood: address.neighborhood.trim(),
    city: address.city.trim(),
    state: address.state.trim().toUpperCase(),
  } satisfies Address;
}

const sameAddress = (left: Address | null, right: Address | null) =>
  JSON.stringify(left) === JSON.stringify(right);

const changedShare = (filled: boolean, stored: boolean, share: boolean) =>
  filled && stored !== share;

export function profileChanges(fields: Fields, draft: ProfileDraft) {
  const changes: ProfileChanges = {};

  for (const key of textKeys) {
    const value = storedText(key, draft[key].value);
    const { share } = draft[key];

    if (value !== fields[key].value || changedShare(value !== null, fields[key].share, share)) {
      changes[key] = { value, share };
    }
  }

  const address = storedAddress(draft.address);
  const { share } = draft.address;

  if (
    !sameAddress(address, fields.address.value) ||
    changedShare(address !== null, fields.address.share, share)
  ) {
    changes.address = { value: address, share };
  }

  return changes;
}

export function answerProblem(answer: string) {
  return answer.trim().length > 2_000 ? "Use até 2.000 caracteres." : undefined;
}
