export type CatalogSource = {
  kind: "greenhouse" | "lever";
  target: string;
  label: string | null;
};

export const catalogSources: readonly CatalogSource[] = [
  { kind: "greenhouse", target: "stone", label: "Stone" },
  { kind: "greenhouse", target: "quintoandar", label: "QuintoAndar" },
];
