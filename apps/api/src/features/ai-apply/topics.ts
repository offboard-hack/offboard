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
  [
    "consent",
    /^(?=.*(?<![a-z0-9])(?:consentimento|consent\w*))(?=.*(?:diversidade|diversity|d ?& ?i\b|inclusao|inclusion|demografic|demographic))/,
  ],
  ["pronoun", word("pronomes?|pronouns?")],
  ["orientation", word("orientacao sexual|sexual orientation")],
  ["trans", word("pessoa trans|transgen\\w*|transexual")],
  ["gender", word("generos?|gender(?: identity)?|sexo")],
  ["race", word("racas?|etnias?|etnic\\w*|race|ethnicity|skin colou?r|cor da pele")],
  ["disability", word("deficiencias?|pcd|disabilit\\w*")],
];

const kin = word("familiar(?:es)?|parentes?|relatives?|family members?|conjuge|spouse");

const workplace = word(
  "trabalh\\w*|work\\w*|employ\\w*|empresa|company|companhia|colaborador\\w*|funcionari\\w*",
);

const acquaintance = word("conhece alguem|pessoas que (?:ja )?trabalham");

const publicOffice = word(
  "politicamente expost\\w*|pep|public officials?|government\\w*|governo|servidor\\w* public\\w*|agentes? public\\w*",
);

const uncertain = word(
  "nao sei|nao tenho certeza|nao se aplica|n/a|not sure|unsure|(?:i )?(?:do not|don.t) know|not applicable|talvez|maybe",
);

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

  if (publicOffice.test(normalized)) return undefined;

  const found = topics.find(([, pattern]) => pattern.test(normalized))?.[0];

  if (kin.test(normalized)) {
    return found === undefined && workplace.test(normalized) ? "relative" : undefined;
  }

  if (acquaintance.test(normalized)) return found === undefined ? "relative" : undefined;

  return found;
};

export const canonicalValue = (topic: Topic, text: string) => {
  const normalized = normalizeQuestion(text);

  if (uncertain.test(normalized)) return undefined;

  const matched = new Set(
    values[topic].flatMap(([value, pattern]) => (pattern.test(normalized) ? [value] : [])),
  );

  if (matched.has("decline")) return "decline";

  return matched.size === 1 ? [...matched][0] : undefined;
};
