const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const day = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

export function formatBRL(cents: number) {
  return brl.format(cents / 100);
}

export function formatDay(value: string | null) {
  return value === null ? "—" : day.format(new Date(value));
}

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}
