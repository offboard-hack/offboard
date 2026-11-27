export function formatNps(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function barWidth(value: number, total: number) {
  return total === 0 ? "0%" : `${Math.min(100, (value / total) * 100)}%`;
}

export function responsesLabel(total: number) {
  return `${total} ${total === 1 ? "resposta" : "respostas"}`;
}

export function placementSummary(placements: {
  isPending: boolean;
  isError: boolean;
  hiresShared: number | null | undefined;
}) {
  if (placements.isPending) return { value: "…", copy: "Carregando relatos de recolocação." };

  if (placements.isError) {
    return { value: "—", copy: "Não foi possível carregar os relatos de recolocação." };
  }

  if (placements.hiresShared == null) {
    return {
      value: "—",
      copy: "Exibido a partir de 5 pessoas com relato autorizado, para preservar o anonimato.",
    };
  }

  return {
    value: placements.hiresShared === 1 ? "1 pessoa" : `${placements.hiresShared} pessoas`,
    copy: "Total baseado em relatos voluntários com autorização.",
  };
}

const commentMonths = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export function commentMonthLabel(month: string) {
  const [year, number] = month.split("-");

  return `${commentMonths[Number(number) - 1]} de ${year}`;
}

export function commentAuthorLabel(author: { name: string; department: string } | null) {
  return author ? `${author.name} · ${author.department}` : "Anônimo";
}
