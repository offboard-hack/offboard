export const diversityValues = {
  gender: ["female", "male", "nonbinary", "cis", "trans", "decline"],
  race: ["white", "black", "brown", "asian", "indigenous", "decline"],
  orientation: ["straight", "gay", "lesbian", "bisexual", "pansexual", "asexual", "decline"],
  disability: [
    "no",
    "physical",
    "visual",
    "hearing",
    "intellectual",
    "mental",
    "autism",
    "decline",
  ],
  pronoun: ["she", "he", "they", "decline"],
} as const;

export type DiversityKey = keyof typeof diversityValues;

export const diversityKeys = [
  "gender",
  "race",
  "orientation",
  "disability",
  "pronoun",
] as const satisfies DiversityKey[];

const combinable = new Set<string>(["gender", "disability"]);

export const isCombinable = (topic: string) => combinable.has(topic);

export function isDiversityValue(key: DiversityKey, value: string) {
  const parts = value.split(";");
  const allowed = new Set<string>(diversityValues[key]);

  if (new Set(parts).size !== parts.length || !parts.every((part) => allowed.has(part))) {
    return false;
  }

  if (parts.length === 1) return true;

  return isCombinable(key) && !parts.includes("decline") && !parts.includes("no");
}
