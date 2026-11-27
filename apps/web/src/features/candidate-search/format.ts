export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function period(start: string, end: string | null) {
  const from = start.slice(0, 4);

  if (!end) return from ? `desde ${from}` : "atual";

  return from ? `${from}–${end.slice(0, 4)}` : `até ${end.slice(0, 4)}`;
}

const failures = new Map([
  [429, "Você fez muitas buscas hoje. Tente de novo amanhã."],
  [503, "A busca está indisponível no momento."],
]);

export function searchFailure(status: number) {
  return failures.get(status) ?? "Não foi possível buscar. Tente de novo.";
}

export function resultSummary(count: number, query: string) {
  if (count === 0) return `Ninguém encontrado para “${query}”. Tente descrever de outro jeito.`;

  return `${count} ${count === 1 ? "pessoa" : "pessoas"} para “${query}”`;
}

export const examples = [
  "Dev backend que fala inglês",
  "Quem já liderou time",
  "Designer de produto",
  "Vendas B2B em São Paulo",
  "Analista de dados com SQL",
];
