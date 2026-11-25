export type SeedJobSource = {
  kind: "greenhouse" | "lever";
  target: string;
  label: string;
  enabled: boolean;
};

export const seedJobSources: SeedJobSource[] = [
  { kind: "greenhouse", target: "quintoandar", label: "QuintoAndar", enabled: false },
  { kind: "greenhouse", target: "stone", label: "Stone", enabled: false },
];
