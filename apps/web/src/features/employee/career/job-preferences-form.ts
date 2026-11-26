import type { CareerPreferences } from "@/entities/career";
import { createLocalId } from "@/shared/lib/create-local-id";
import { states } from "./preferences-form";

type Stored = Pick<CareerPreferences, "targetTitles" | "jobPreferences">;

type JobPreferences = CareerPreferences["jobPreferences"];

export type WorkModel = JobPreferences["workModels"][number];

export type PlaceDraft = { id: string; state: string; city: string };

export type JobDraft = {
  titles: string;
  workModels: WorkModel[];
  places: PlaceDraft[];
  relocate: boolean;
  salaryFloor: string;
  excluded: string;
};

export type JobChanges = {
  targetTitles?: string[];
  jobPreferences?: Partial<Omit<JobPreferences, "seniorities">>;
};

export const workModelOptions = [
  { value: "remote", label: "Remoto" },
  { value: "hybrid", label: "Híbrido" },
  { value: "onsite", label: "Presencial" },
] as const satisfies { value: WorkModel; label: string }[];

const maxCents = 2_147_483_647;

const knownStates = new Set(states);

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

function distinct(values: string[]) {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = value.toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}

function reais(cents: number) {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return rest === 0 ? grouped : `${grouped},${String(rest).padStart(2, "0")}`;
}

export function salaryCents(text: string) {
  const value = text.trim().replace(/^r\$\s*/i, "");

  if (value === "") return null;

  const match = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(value);

  if (match === null) return undefined;

  const cents =
    Number(match[1].replaceAll(".", "")) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));

  return cents > maxCents ? undefined : cents;
}

const storedPlaces = (places: PlaceDraft[]) =>
  places.flatMap((place) => {
    const state = place.state.trim().toUpperCase();
    const city = place.city.trim();

    return state === "" && city === "" ? [] : [{ city: city === "" ? null : city, state }];
  });

export const newPlace = (makeId = createLocalId) => ({ id: makeId(), state: "", city: "" });

export function jobDraft(stored: Stored, makeId = createLocalId) {
  const { jobPreferences: preferences } = stored;

  return {
    titles: stored.targetTitles.join("\n"),
    workModels: [...preferences.workModels],
    places: preferences.locations.map((place) => ({
      id: makeId(),
      state: place.state,
      city: place.city ?? "",
    })),
    relocate: preferences.relocate,
    salaryFloor: preferences.salaryFloorCents === null ? "" : reais(preferences.salaryFloorCents),
    excluded: preferences.excludedCompanies.join("\n"),
  } satisfies JobDraft;
}

export function jobProblems(draft: JobDraft) {
  const titles = lines(draft.titles);
  const companies = lines(draft.excluded);
  const places = storedPlaces(draft.places);

  return {
    titles:
      titles.length > 20
        ? "Use até 20 cargos."
        : titles.some((title) => title.length < 2 || title.length > 100)
          ? "Cada cargo deve ter de 2 a 100 caracteres."
          : undefined,
    places:
      places.length > 20
        ? "Use até 20 locais."
        : places.some((place) => !knownStates.has(place.state))
          ? "Use a sigla do estado, como RS."
          : places.some((place) => (place.city ?? "").length > 100)
            ? "O nome da cidade está longo demais."
            : undefined,
    salaryFloor:
      salaryCents(draft.salaryFloor) === undefined ? "Use um valor como 8.000." : undefined,
    excluded:
      companies.length > 50
        ? "Use até 50 empresas."
        : companies.some((company) => company.length > 200)
          ? "O nome da empresa está longo demais."
          : undefined,
  };
}

const same = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

const sorted = (models: WorkModel[]) =>
  workModelOptions.flatMap(({ value }) => (models.includes(value) ? [value] : []));

export function jobChanges(stored: Stored, draft: JobDraft) {
  const changes: JobChanges = {};
  const preferences: NonNullable<JobChanges["jobPreferences"]> = {};
  const titles = distinct(lines(draft.titles));
  const workModels = sorted(draft.workModels);
  const locations = storedPlaces(draft.places);
  const salaryFloorCents = salaryCents(draft.salaryFloor) ?? null;
  const excludedCompanies = distinct(lines(draft.excluded));
  const current = stored.jobPreferences;

  if (!same(titles, stored.targetTitles)) changes.targetTitles = titles;

  if (!same(workModels, sorted(current.workModels))) preferences.workModels = workModels;

  const placeKey = (place: { city: string | null; state: string }) =>
    `${place.state}|${place.city ?? ""}`;

  if (!same(locations.map(placeKey), current.locations.map(placeKey))) {
    preferences.locations = locations;
  }

  if (draft.relocate !== current.relocate) preferences.relocate = draft.relocate;

  if (salaryFloorCents !== current.salaryFloorCents)
    preferences.salaryFloorCents = salaryFloorCents;

  if (!same(excludedCompanies, current.excludedCompanies)) {
    preferences.excludedCompanies = excludedCompanies;
  }

  if (Object.keys(preferences).length > 0) changes.jobPreferences = preferences;

  return changes;
}
