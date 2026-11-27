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

const thirdParty = word(
  "familia|family|familiar(?:es)?|parentes?|relatives?|family members?|filh[oa]s?|child(?:ren)?|dependentes?|dependents?|esposa|marido|companheir[oa]|partner|spouse|conjuge|pais|parents?|mae|pai|irma[os]?|siblings?|cuida(?:r)? de alguem|care for|responda pelo",
);

const workplace = word("trabalh\\w*|works?|working|employ\\w*|empresa|company|companhia");

const relativeVeto = word(
  "pep|politicamente|public (?:officials?|office)|orgaos? publicos?|governo|government|concorrentes?|competitors?|fornecedor\\w*|suppliers?",
);

const topics: [Topic, RegExp][] = [
  [
    "consent",
    /^(?=.*(?<![a-z0-9])(?:consentimento|consent\w*))(?=.*(?:diversidade|diversity|d ?& ?i\b|inclusao|inclusion|demografic|demographic))/,
  ],
  [
    "relative",
    new RegExp(
      `^(?=.*${workplace.source})(?!.*${relativeVeto.source})(?=.*${word("parentes?|familiares?|relatives?|family members?|conhece alguem|pessoas que (?:ja )?trabalham").source})`,
    ),
  ],
  ["pronoun", word("pronomes?|pronouns?")],
  ["orientation", word("orientacao sexual|sexual orientation")],
  ["trans", word("pessoa trans|transgen\\w*|transexual")],
  ["gender", word("generos?|gender(?: identity)?|sexo")],
  ["race", word("racas?|etnias?|etnic\\w*|race|ethnicity|skin colou?r|cor da pele")],
  ["disability", word("deficiencias?|pcd|disabilit\\w*")],
];

const decline: Values = [
  [
    "decline",
    word(
      "prefiro nao\\w*|prefer not\\w*|nao (?:desejo|quero) (?:informar|responder|declarar|me identificar)|nao informar|decline\\w*|rather not|(?:i )?(?:do not|don.t) (?:wish|want) to (?:answer|disclose|say|respond|share)",
    ),
  ],
];

const answered: Values = [
  [
    "no",
    new RegExp(
      `(?:(?:nao|no)\\s*(?:[.,;:!]|$)|${word("nao (?:possuo|sou|tenho|autorizo|concordo)|i do not|i don.t|discordo|i disagree|recuso|nenhuma das anteriores|none of the above").source})`,
    ),
  ],
  ["yes", word("sim|yes|concordo|i agree|i consent|aceito")],
];

const unsure = word(
  "nao sei|nao tenho certeza|nao tenho como saber|nao tenho conhecimento|nao se aplica|nao aplicavel|nao sei informar|not sure|unsure|n ?/ ?a|i do not know|i don.t know",
);

const startsWith = (values: Values) =>
  values.map(
    ([value, pattern]) => [value, new RegExp(`^(?:${pattern.source})`)] satisfies [string, RegExp],
  );

const values: Record<Topic, Values> = {
  consent: [...decline, ...startsWith(answered)],
  relative: [...decline, ...startsWith(answered)],
  trans: [...decline, ...startsWith(answered)],
  pronoun: [
    ...decline,
    ["they", word("elu|delu|they|them")],
    ["she", word("ela|dela|she|her")],
    ["he", word("ele|dele|he|him")],
  ],
  orientation: [
    ...decline,
    ["bisexual", word("bissexual|bisexual")],
    ["pansexual", word("pansexual")],
    ["asexual", word("assexual|asexual")],
    ["lesbian", word("lesbica|lesbian")],
    ["gay", word("gay")],
    ["straight", word("heterossexual|heterosexual|hetero|straight")],
  ],
  gender: [
    ...decline,
    ["nonbinary", word("nao[- ]binari[oae]|non[- ]?binary|genero fluido|genderfluid")],
    ["cis", word("cisgen\\w*|cis")],
    ["trans", word("transgen\\w*|transexual|trans")],
    ["female", word("feminino|mulher|female|woman")],
    ["male", word("masculino|homem|male|man")],
  ],
  race: [
    ...decline,
    ["white", word("branc[oa]s?|white")],
    ["black", word("pret[oa]s?|negr[oa]s?|black")],
    ["brown", word("pard[oa]s?|brown|mixed")],
    ["asian", word("amarel[oa]s?|asian|asiatic[oa]s?")],
    ["indigenous", word("indigenas?|indigenous")],
  ],
  disability: [
    ...decline,
    ...startsWith(answered.slice(0, 1)),
    ["physical", word("fisica|physical")],
    ["visual", word("visual")],
    ["hearing", word("auditiva|hearing|surdez|deaf\\w*")],
    ["intellectual", word("intelectual|intellectual")],
    ["mental", word("mental|psicossocial|psychosocial")],
    ["autism", word("autis\\w*")],
  ],
};

export const topicOf = (label: string) => {
  const normalized = normalizeQuestion(label);

  const own = normalizeQuestion(label.replace(/\?\s*\([^)]*\)\s*$/, "?"));
  const found = topics.filter(([, pattern]) => pattern.test(own));
  const [first] = found;

  const topic = found.some(([name]) => name === "consent")
    ? "consent"
    : found.length === 1
      ? first?.[0]
      : undefined;

  return topic !== "relative" && thirdParty.test(normalized) ? undefined : topic;
};

export const canonicalValue = (topic: Topic, text: string) => {
  const normalized = normalizeQuestion(text);

  const matched = new Set(
    values[topic].flatMap(([value, pattern]) => (pattern.test(normalized) ? [value] : [])),
  );

  if (matched.has("decline")) return "decline";

  if (unsure.test(normalized)) return undefined;

  return matched.size === 1 ? [...matched][0] : undefined;
};
