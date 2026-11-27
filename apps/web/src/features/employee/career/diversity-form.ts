import type { CareerPreferences } from "@/entities/career";

type Fields = CareerPreferences["profileFields"];

export type DiversityKey = "gender" | "race" | "orientation" | "disability" | "pronoun";

export type DiversityDraft = Record<DiversityKey, { values: string[]; share: boolean }>;

const decline = { value: "decline", label: "Prefiro não informar" };

export const diversityFields = [
  {
    key: "gender",
    label: "Gênero",
    multiple: true,
    hint: "Marque tudo o que se aplica, por exemplo Mulher e Cisgênero.",
    options: [
      { value: "female", label: "Mulher" },
      { value: "male", label: "Homem" },
      { value: "nonbinary", label: "Pessoa não binária" },
      { value: "cis", label: "Cisgênero" },
      { value: "trans", label: "Transgênero" },
      decline,
    ],
  },
  {
    key: "race",
    label: "Raça/cor",
    multiple: false,
    hint: null,
    options: [
      { value: "white", label: "Branca" },
      { value: "black", label: "Preta" },
      { value: "brown", label: "Parda" },
      { value: "asian", label: "Amarela" },
      { value: "indigenous", label: "Indígena" },
      decline,
    ],
  },
  {
    key: "orientation",
    label: "Orientação sexual",
    multiple: false,
    hint: null,
    options: [
      { value: "straight", label: "Heterossexual" },
      { value: "gay", label: "Gay" },
      { value: "lesbian", label: "Lésbica" },
      { value: "bisexual", label: "Bissexual" },
      { value: "pansexual", label: "Pansexual" },
      { value: "asexual", label: "Assexual" },
      decline,
    ],
  },
  {
    key: "disability",
    label: "Pessoa com deficiência (PcD)",
    multiple: true,
    hint: null,
    options: [
      { value: "no", label: "Não tenho deficiência" },
      { value: "physical", label: "Física" },
      { value: "visual", label: "Visual" },
      { value: "hearing", label: "Auditiva" },
      { value: "intellectual", label: "Intelectual" },
      { value: "mental", label: "Mental ou psicossocial" },
      { value: "autism", label: "Autismo (TEA)" },
      decline,
    ],
  },
  {
    key: "pronoun",
    label: "Pronome",
    multiple: false,
    hint: null,
    options: [
      { value: "she", label: "Ela/dela" },
      { value: "he", label: "Ele/dele" },
      { value: "they", label: "Elu/delu" },
      decline,
    ],
  },
] as const satisfies {
  key: DiversityKey;
  label: string;
  multiple: boolean;
  hint: string | null;
  options: { value: string; label: string }[];
}[];

const exclusive = new Set(["decline", "no"]);

export function diversityDraft(fields: Fields) {
  const entry = (key: DiversityKey) => ({
    values: fields[key].value === null ? [] : fields[key].value.split(";"),
    share: fields[key].value === null || fields[key].share,
  });

  return {
    gender: entry("gender"),
    race: entry("race"),
    orientation: entry("orientation"),
    disability: entry("disability"),
    pronoun: entry("pronoun"),
  } satisfies DiversityDraft;
}

export function toggled(multiple: boolean, current: string[], value: string, on: boolean) {
  if (!multiple) return on ? [value] : [];

  if (!on) return current.filter((item) => item !== value);

  if (exclusive.has(value)) return [value];

  return [...current.filter((item) => !exclusive.has(item)), value];
}

function stored(order: readonly { value: string }[], values: string[]) {
  const chosen = order.flatMap((option) => (values.includes(option.value) ? [option.value] : []));

  return chosen.length === 0 ? null : chosen.join(";");
}

export function diversityChanges(fields: Fields, draft: DiversityDraft) {
  const changes: Partial<Pick<Fields, DiversityKey>> = {};

  for (const { key, options } of diversityFields) {
    const value = stored(options, draft[key].values);
    const { share } = draft[key];
    const shareChanged = value !== null && fields[key].share !== share;

    if (value !== fields[key].value || shareChanged) changes[key] = { value, share };
  }

  return changes;
}
