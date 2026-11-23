import type { equipment } from "./schema/index.ts";

type EquipmentRow = typeof equipment.$inferInsert;

export type SeedEquipment = Pick<EquipmentRow, "item" | "tag" | "returnMethod" | "status"> & {
  person: string;
  scheduledDate?: string;
};

export const seedEquipment: readonly SeedEquipment[] = [
  {
    item: "Notebook Dell Latitude 5440",
    tag: "AUR-0412",
    person: "Marina Lopes",
    returnMethod: "pickup",
    scheduledDate: "2026-11-10",
    status: "scheduled",
  },
  {
    item: "Notebook MacBook Air M3",
    tag: "AUR-0398",
    person: "Rafael Mendes",
    returnMethod: "pickup",
    status: "received",
  },
  {
    item: "Notebook Dell Latitude 5440",
    tag: "AUR-0377",
    person: "Bianca Souza",
    returnMethod: "pickup",
    scheduledDate: "2026-11-09",
    status: "failed",
  },
  {
    item: "Celular Galaxy A55",
    tag: "AUR-2210",
    person: "André Lima",
    returnMethod: "in_person",
    status: "inventory",
  },
  {
    item: "Notebook ThinkPad T14",
    tag: "AUR-0455",
    person: "Nina Castro",
    returnMethod: "pickup",
    status: "transit",
  },
  {
    item: "Monitor Dell 27″",
    tag: "AUR-3104",
    person: "Nina Castro",
    returnMethod: "pickup",
    status: "transit",
  },
  {
    item: "Notebook MacBook Pro 14",
    tag: "AUR-0301",
    person: "Gustavo Ribeiro",
    returnMethod: "pickup",
    scheduledDate: "2026-11-12",
    status: "with_person",
  },
  {
    item: "Kit EPI e rádio",
    tag: "AUR-5520",
    person: "Carla Mendonça",
    returnMethod: "in_person",
    status: "received",
  },
  {
    item: "Notebook Dell Latitude 5440",
    tag: "AUR-0419",
    person: "Felipe Oliveira",
    returnMethod: "pickup",
    scheduledDate: "2026-11-11",
    status: "scheduled",
  },
];
