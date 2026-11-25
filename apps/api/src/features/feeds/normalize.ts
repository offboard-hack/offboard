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

const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const ufByName = new Map<string, string>(states.map(([uf, name]) => [fold(name), uf]));
const ufs = new Set<string>(states.map(([uf]) => uf));

const separator = /(\s+[-–]\s+|[,/()])/;
const brazilMention = /\bbra[sz]il/;
const noise = /^(?:bra[sz]il|remot[aoe]|h[iy]brid[oa]?|presencial|on-?site)$/;

export const brazilState = (text: string) => {
  const trimmed = text.trim();

  return ufs.has(trimmed) ? trimmed : (ufByName.get(fold(trimmed)) ?? null);
};

const stateOf = (segment: { text: string; dashed: boolean }, inBrazil: boolean) =>
  ufs.has(segment.text) && !inBrazil && !segment.dashed ? null : brazilState(segment.text);

const parseGroup = (text: string) => {
  const pieces = text.split(separator);
  const inBrazil = brazilMention.test(fold(text));

  const segments = pieces.flatMap((piece, index) =>
    index % 2 === 0 && piece.trim() !== ""
      ? [{ text: piece.trim(), dashed: /[-–]/.test(pieces[index - 1] ?? "") }]
      : [],
  );

  let found = segments.length - 1;

  while (found >= 0 && stateOf(segments[found], inBrazil) === null) found -= 1;

  const state = found >= 0 ? stateOf(segments[found], inBrazil) : null;
  const first = segments[0];

  const city =
    found > 0 && !noise.test(fold(first.text)) && !ufs.has(first.text) ? first.text : null;

  return { city, state, inBrazil: inBrazil || state !== null };
};

export const parseLocation = (text: string) => {
  const places = text.split(/[;|]/).map((group) => parseGroup(group));

  return places.find((place) => place.inBrazil) ?? places[0];
};

export const workModelFrom = (text: string) => {
  const folded = fold(text);

  if (/\bh[iy]brid[oa]?\b/.test(folded)) return "hybrid" as const;

  if (/\bremot[aoe]\b/.test(folded)) return "remote" as const;

  return null;
};
