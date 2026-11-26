import { z } from "zod";
import { careerSchema, jobSchema } from "./career.ts";
import { departureSchema } from "./departure.ts";

const text = z.string().trim().min(1).max(255);
const address = z.string().trim().min(1).max(350);

const equipmentItem = z.object({
  code: text,
  title: text,
  model: z.string().trim().max(200),
});

const handoffItem = z.object({ id: text, title: text, owner: text, area: text });

export const employeePlanSchema = z.object({
  company: text.nullable(),
  officeAddress: address.nullable(),
  lastDay: z.iso.date().nullable(),
  exam: z
    .object({
      day: z.iso.date(),
      time: z.iso.time({ precision: -1 }),
      clinic: text,
      address,
    })
    .nullable(),
  bookingDays: z.array(z.iso.date()).max(31),
  equipment: z.array(equipmentItem).max(100),
  handoff: z.array(handoffItem).max(100),
  jobs: z.array(jobSchema).max(100),
});

export type EmployeePlan = z.infer<typeof employeePlanSchema>;

export const emptyEmployeePlan: EmployeePlan = {
  company: null,
  officeAddress: null,
  lastDay: null,
  exam: null,
  bookingDays: [],
  equipment: [],
  handoff: [],
  jobs: [],
};

export const employeeAccessSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()).nullable(),
  plan: employeePlanSchema,
  revision: z.int().min(0).max(2_147_483_646),
  careerSponsoredUntil: z.iso.date().nullable().optional(),
});

export const employeeAccessSettingsSchema = employeeAccessSchema.extend({
  careerSponsoredUntil: z.iso.date(),
  careerSponsoredIsDefault: z.boolean(),
});

export const employeeGrantHeader = "x-offboard-employee-grant";

export const employeeLoginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Informe um e-mail válido.")),
});

export const employeeCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Informe o código de seis dígitos."),
});

export const consentSchema = z.object({ accepted: z.boolean() });
export const stateKindSchema = z.enum(["consent", "departure-v1", "career"]);

const revision = z.number().int().min(0).max(2_147_483_646);

export const employeeStateSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("consent"), revision, value: consentSchema }),
  z.object({ key: z.literal("departure-v1"), revision, value: departureSchema }),
  z.object({ key: z.literal("career"), revision, value: careerSchema }),
]);

export type EmployeeState = z.infer<typeof employeeStateSchema>;

export const brazilTimezone = "America/Sao_Paulo";

export function employeeDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: "UTC" }).format(
    new Date(date + "T12:00:00Z"),
  );
}
