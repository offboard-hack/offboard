const arithmetic = /[×≈=]|(?<!\d)\d+\s*\/\s*(?!\d{4})\d+/;
const parenthetical = /\s*\([^()]*\)/g;
const clause = /(?:[^.!?;,]|[.,](?=\S))+[.!?;,]*/g;

export function plainReason(reason: string) {
  const withoutGroups = reason.replace(parenthetical, (group) =>
    arithmetic.test(group) ? "" : group,
  );

  const kept = (withoutGroups.match(clause) ?? [])
    .map((part) => part.trim())
    .filter((part) => part && !arithmetic.test(part))
    .join(" ")
    .replace(/[,;]+$/, ".");

  return kept.slice(0, 1).toUpperCase() + kept.slice(1);
}
