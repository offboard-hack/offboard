import type { equipment } from "./schema/index.ts";

type EquipmentRow = typeof equipment.$inferInsert;

export type SeedEquipment = Pick<EquipmentRow, "item" | "tag" | "status"> &
  Partial<
    Pick<
      EquipmentRow,
      | "serialNumber"
      | "assignedTo"
      | "assignedEmail"
      | "returnMethod"
      | "trackingCode"
      | "scheduledDate"
      | "notes"
    >
  > & {
    caseName?: string;
    taskTitle?: string;
  };

export const seedEquipment: readonly SeedEquipment[] = [
  {
    item: "Notebook Dell Latitude 5440",
    tag: "PAT-0412",
    serialNumber: "DL5440-7QK2M91",
    assignedTo: "Marina Lopes",
    assignedEmail: "marina.lopes@offboard.com",
    status: "pending_return",
    returnMethod: "pickup",
    scheduledDate: "2026-11-10",
    caseName: "Marina Lopes",
    taskTitle: "Coletar notebook e acessórios",
  },
  {
    item: "Headset Jabra Evolve2 65",
    tag: "PAT-1180",
    serialNumber: "JB65-0042187",
    assignedTo: "Marina Lopes",
    assignedEmail: "marina.lopes@offboard.com",
    status: "pending_return",
    returnMethod: "pickup",
    scheduledDate: "2026-11-10",
    caseName: "Marina Lopes",
    taskTitle: "Coletar notebook e acessórios",
  },
  {
    item: "Notebook MacBook Air M3",
    tag: "PAT-0398",
    serialNumber: "C02MA3X9QD",
    assignedTo: "Rafael Mendes",
    assignedEmail: "rafael.mendes@offboard.com",
    status: "in_transit",
    returnMethod: "correios",
    trackingCode: "BR987654321BR",
    caseName: "Rafael Mendes",
    taskTitle: "Recolher equipamentos",
  },
  {
    item: "Notebook Dell Latitude 5440",
    tag: "PAT-0377",
    serialNumber: "DL5440-3HN8P55",
    assignedTo: "Bianca Souza",
    assignedEmail: "bianca.souza@offboard.com",
    status: "in_transit",
    returnMethod: "correios",
    trackingCode: "BR456789012BR",
    notes: "Duas tentativas de coleta sem sucesso; reenviado pelos Correios.",
    caseName: "Bianca Souza",
    taskTitle: "Recolher equipamentos",
  },
  {
    item: "Celular Galaxy A55",
    tag: "PAT-2210",
    serialNumber: "R5CX30ABCDE",
    assignedTo: "André Lima",
    assignedEmail: "andre.lima@offboard.com",
    status: "received",
    returnMethod: "in_person",
    caseName: "André Lima",
  },
  {
    item: "Notebook ThinkPad T14",
    tag: "PAT-0455",
    serialNumber: "PF3K7T14",
    assignedTo: "Nina Castro",
    assignedEmail: "nina.castro@offboard.com",
    status: "pending_return",
    returnMethod: "in_person",
    caseName: "Nina Castro",
  },
  {
    item: "Monitor Dell 27″",
    tag: "PAT-3104",
    serialNumber: "CN-0D27-74261",
    assignedTo: "Nina Castro",
    assignedEmail: "nina.castro@offboard.com",
    status: "pending_return",
    returnMethod: "in_person",
    caseName: "Nina Castro",
  },
  {
    item: "Notebook MacBook Pro 14",
    tag: "PAT-0301",
    serialNumber: "FVFH2MBP14",
    assignedTo: "Gustavo Ribeiro",
    assignedEmail: "gustavo.ribeiro@offboard.com",
    status: "pending_return",
    returnMethod: "pickup",
    scheduledDate: "2026-11-12",
    caseName: "Gustavo Ribeiro",
    taskTitle: "Coletar notebook e acessórios",
  },
  {
    item: "Notebook Dell Latitude 5440",
    tag: "PAT-0419",
    serialNumber: "DL5440-9TR4B20",
    assignedTo: "Felipe Oliveira",
    assignedEmail: "felipe.oliveira@offboard.com",
    status: "in_use",
  },
  {
    item: "Teclado Logitech MX Keys",
    tag: "PAT-4101",
    serialNumber: "2214LZ0A5BC9",
    assignedTo: "Carla Mendonça",
    assignedEmail: "carla.mendonca@offboard.com",
    status: "in_use",
  },
  {
    item: "iPhone 14",
    tag: "PAT-2305",
    serialNumber: "DX3F9PLM2K",
    assignedTo: "Camila Torres",
    assignedEmail: "camila.torres@offboard.com",
    status: "in_use",
  },
  {
    item: "Notebook Dell Latitude 5540",
    tag: "PAT-0520",
    serialNumber: "DL5540-1WB6C03",
    status: "in_inventory",
  },
  {
    item: "Monitor LG UltraWide 34″",
    tag: "PAT-3120",
    serialNumber: "LG34-408NTAB",
    status: "in_inventory",
  },
  {
    item: "Headset Jabra Evolve2 65",
    tag: "PAT-1201",
    serialNumber: "JB65-0042990",
    status: "in_inventory",
  },
  {
    item: "Notebook Dell Latitude 3420",
    tag: "PAT-0210",
    serialNumber: "DL3420-5ZP7K18",
    status: "decommissioned",
    notes: "Tela danificada; baixa patrimonial aprovada.",
  },
];
