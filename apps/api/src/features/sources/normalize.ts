const states = [
  ["AC", "Acre"],
  ["AL", "Alagoas"],
  ["AP", "Amapá"],
  ["AM", "Amazonas"],
  ["BA", "Bahia"],
  ["CE", "Ceará"],
  ["DF", "Distrito Federal"],
  ["ES", "Espírito Santo"],
  ["GO", "Goiás"],
  ["MA", "Maranhão"],
  ["MT", "Mato Grosso"],
  ["MS", "Mato Grosso do Sul"],
  ["MG", "Minas Gerais"],
  ["PA", "Pará"],
  ["PB", "Paraíba"],
  ["PR", "Paraná"],
  ["PE", "Pernambuco"],
  ["PI", "Piauí"],
  ["RJ", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte"],
  ["RS", "Rio Grande do Sul"],
  ["RO", "Rondônia"],
  ["RR", "Roraima"],
  ["SC", "Santa Catarina"],
  ["SP", "São Paulo"],
  ["SE", "Sergipe"],
  ["TO", "Tocantins"],
] as const;

const cities = [
  [
    "SP",
    [
      "São Paulo",
      "Campinas",
      "Guarulhos",
      "Santos",
      "Osasco",
      "Barueri",
      "Santo André",
      "São Bernardo do Campo",
      "São Caetano do Sul",
      "Sorocaba",
      "Ribeirão Preto",
      "Jundiaí",
      "Piracicaba",
      "Bauru",
      "São José dos Campos",
      "São José do Rio Preto",
      "Santana de Parnaíba",
      "Cotia",
      "Americana",
      "Taubaté",
    ],
  ],
  ["RJ", ["Rio de Janeiro", "Niterói", "Duque de Caxias", "Nova Iguaçu", "Petrópolis"]],
  ["MG", ["Belo Horizonte", "Uberlândia", "Contagem", "Juiz de Fora", "Betim", "Montes Claros"]],
  ["PR", ["Curitiba", "Londrina", "Maringá", "Ponta Grossa", "Cascavel", "São José dos Pinhais"]],
  ["RS", ["Porto Alegre", "Caxias do Sul", "Pelotas", "Canoas", "Santa Maria"]],
  ["SC", ["Florianópolis", "Joinville", "Blumenau", "Itajaí", "Balneário Camboriú"]],
  ["PE", ["Recife", "Jaboatão dos Guararapes", "Olinda"]],
  ["DF", ["Brasília"]],
  ["BA", ["Salvador", "Feira de Santana"]],
  ["CE", ["Fortaleza"]],
  ["GO", ["Goiânia"]],
  ["AM", ["Manaus"]],
  ["PA", ["Belém"]],
  ["ES", ["Vitória", "Vila Velha"]],
  ["MT", ["Cuiabá"]],
  ["MS", ["Campo Grande"]],
  ["PB", ["João Pessoa"]],
  ["RN", ["Natal"]],
  ["AL", ["Maceió"]],
  ["SE", ["Aracaju"]],
  ["PI", ["Teresina"]],
  ["MA", ["São Luís"]],
  ["TO", ["Palmas"]],
  ["RO", ["Porto Velho"]],
  ["AC", ["Rio Branco"]],
  ["AP", ["Macapá"]],
  ["RR", ["Boa Vista"]],
] as const;

const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const ufByName = new Map<string, string>(states.map(([uf, name]) => [fold(name), uf]));
const ufs = new Set<string>(states.map(([uf]) => uf));

const ufByCity = new Map<string, string>(
  cities.flatMap(([uf, names]) => names.map((name) => [fold(name), uf] as const)),
);

const separator = /(\s+[-–]\s+|[,/()])/;
const brazilMention = /\bbra[sz]il/;
const workModelOnly = /^(?:remot[oa]|hibrido|presencial|home office)$/;
const noise = /^(?:bra[sz]il|remot[aoe]|h[iy]brid[oa]?|presencial|on-?site)$/;

export const mentionsBrazil = (text: string) =>
  brazilMention.test(fold(text)) || /\bBR\b/.test(text);

export const brazilState = (text: string) => {
  const trimmed = text.trim();

  return ufs.has(trimmed) ? trimmed : (ufByName.get(fold(trimmed)) ?? null);
};

const stateOf = (text: string, trusted: boolean) =>
  ufs.has(text) ? (trusted ? text : null) : (brazilState(text) ?? ufByCity.get(fold(text)) ?? null);

const parseGroup = (text: string) => {
  const pieces = text.split(separator);
  const inBrazil = mentionsBrazil(text);

  const segments = pieces.flatMap((piece, index) =>
    index % 2 === 0 && piece.trim() !== "" ? [piece.trim()] : [],
  );

  const trusted = inBrazil || segments.some((segment) => ufByCity.has(fold(segment)));
  let found = segments.length - 1;

  while (found >= 0 && stateOf(segments[found], trusted) === null) found -= 1;

  const state = found >= 0 ? stateOf(segments[found], trusted) : null;
  const first = segments[0];

  const city = found > 0 && !noise.test(fold(first)) && !ufs.has(first) ? first : null;

  return { city, state, inBrazil: inBrazil || state !== null };
};

export const parseLocation = (text: string) => {
  if (workModelOnly.test(fold(text).replace(/^[^a-z]+|[^a-z]+$/g, ""))) {
    return { city: null, state: null, inBrazil: true };
  }

  const places = text.split(/[;|]/).map((group) => parseGroup(group));

  return places.find((place) => place.inBrazil) ?? places[0];
};

export const workModelFrom = (text: string) => {
  const folded = fold(text);

  if (/\bh[iy]brid[oa]?\b/.test(folded)) return "hybrid" as const;

  if (/\bremot[aoe]\b/.test(folded)) return "remote" as const;

  return null;
};
