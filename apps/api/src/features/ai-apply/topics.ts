import { normalizeQuestion } from "@offboard/db/question";

export type Topic =
  | "consent"
  | "relative"
  | "pronoun"
  | "orientation"
  | "trans"
  | "gender"
  | "race"
  | "disability";

type Values = [string, RegExp][];

const word = (pattern: string) => new RegExp(`(?<![a-z0-9])(?:${pattern})(?![a-z0-9])`);

const topics: [Topic, RegExp][] = [
  ["consent", word("consentimento|consent\\w*")],
  [
    "relative",
    word(
      "parentes?|familiares?|relatives?|family members?|conhece alguem|pessoas que (?:ja )?trabalham",
    ),
  ],
  ["pronoun", word("pronomes?|pronouns?")],
  ["orientation", word("orientacao sexual|sexual orientation")],
  ["trans", word("pessoa trans|transgen\\w*|transexual|cisgen\\w*")],
  ["gender", word("generos?|gender(?: identity)?|sexo")],
  ["race", word("racas?|etnias?|etnic\\w*|race|ethnicity|skin colou?r|cor da pele")],
  ["disability", word("deficiencias?|pcd|disabilit\\w*")],
];

const decline: Values = [
  [
    "decline",
    word(
      "prefiro nao\\w*|prefer not\\w*|nao (?:desejo|quero) (?:informar|responder|declarar)|nao informar|decline\\w*|rather not",
    ),
  ],
];

const answered: Values = [
  [
    "no",
    word(
      "nao|no|nao possuo|nao tenho|nao sou|nenhum[a]?|nenhuma das anteriores|none(?: of the above)?|nao concordo|i do not|i don.t",
    ),
  ],
  ["yes", word("sim|yes|concordo|i agree|i consent|aceito")],
];

const startsWith = (values: Values) =>
  values.map(
    ([value, pattern]) => [value, new RegExp(`^(?:${pattern.source})`)] satisfies [string, RegExp],
  );

const values = new Map<Topic, Values>([
  ["consent", [...decline, ...startsWith(answered)]],
  ["relative", [...decline, ...startsWith(answered)]],
  ["trans", [...decline, ...startsWith(answered)]],
  [
    "pronoun",
    [
      ...decline,
      ["they", word("elu|delu|they|them")],
      ["she", word("ela|dela|she|her")],
      ["he", word("ele|dele|he|him")],
    ],
  ],
  [
    "orientation",
    [
      ...decline,
      ["bisexual", word("bissexual|bisexual")],
      ["pansexual", word("pansexual")],
      ["asexual", word("assexual|asexual")],
      ["lesbian", word("lesbica|lesbian")],
      ["gay", word("gay|homossexual|homosexual")],
      ["straight", word("heterossexual|heterosexual|hetero|straight")],
    ],
  ],
  [
    "gender",
    [
      ...decline,
      ["nonbinary", word("nao[- ]binari[oae]|non[- ]?binary|genero fluido|genderfluid")],
      ["cis", word("cisgen\\w*|cis")],
      ["trans", word("transgen\\w*|transexual|trans")],
      ["female", word("feminino|mulher|female|woman")],
      ["male", word("masculino|homem|male|man")],
    ],
  ],
  [
    "race",
    [
      ...decline,
      ["white", word("branc[oa]s?|white")],
      ["black", word("pret[oa]s?|negr[oa]s?|black")],
      ["brown", word("pard[oa]s?|brown|mixed")],
      ["asian", word("amarel[oa]s?|asian|asiatic[oa]s?")],
      ["indigenous", word("indigenas?|indigenous")],
    ],
  ],
  [
    "disability",
    [
      ...decline,
      ...startsWith(answered.slice(0, 1)),
      ["physical", word("fisica|physical")],
      ["visual", word("visual")],
      ["hearing", word("auditiva|hearing|surdez|deaf\\w*")],
      ["intellectual", word("intelectual|intellectual")],
      ["mental", word("mental|psicossocial|psychosocial")],
      ["autism", word("autis\\w*")],
    ],
  ],
]);

export const topicOf = (label: string) => {
  const normalized = normalizeQuestion(label);

  return topics.find(([, pattern]) => pattern.test(normalized))?.[0];
};

export const canonicalValue = (topic: Topic, text: string) => {
  const normalized = normalizeQuestion(text);

  return values.get(topic)?.find(([, pattern]) => pattern.test(normalized))?.[0];
};
