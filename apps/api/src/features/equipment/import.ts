import type { ManualEquipment } from "./repository.js";

export type ImportedEquipment = ManualEquipment & { person: string };

export type ImportProblem = "unknown-person" | "ambiguous-person" | "tag-in-use" | "repeated-tag";

type CaseMatch = { id: string; name: string; email: string | null };

export function personKey(person: string) {
  return person.trim().toLowerCase();
}

export function resolveImport(
  rows: ImportedEquipment[],
  cases: CaseMatch[],
  usedTags: ReadonlySet<string>,
) {
  const byKey = new Map<string, Set<string>>();

  for (const { id, name, email } of cases) {
    for (const key of [name, email ?? ""].flatMap((value) => personKey(value) || [])) {
      byKey.set(key, (byKey.get(key) ?? new Set()).add(id));
    }
  }

  const seen = new Set<string>();
  const problems: { record: number; problem: ImportProblem }[] = [];
  const values: (ManualEquipment & { caseId: string })[] = [];

  for (const [index, { person, ...item }] of rows.entries()) {
    const [caseId, ...others] = byKey.get(personKey(person)) ?? [];
    const record = index + 1;

    if (!caseId) problems.push({ record, problem: "unknown-person" });
    else if (others.length) problems.push({ record, problem: "ambiguous-person" });
    else if (usedTags.has(item.tag)) problems.push({ record, problem: "tag-in-use" });
    else if (seen.has(item.tag)) problems.push({ record, problem: "repeated-tag" });
    else values.push({ ...item, caseId });

    seen.add(item.tag);
  }

  return { problems, values };
}
