import { z } from "zod";

export const demoDaySchema = z.enum(["24", "25", "26", "27"]);
const daySchema = z.union([demoDaySchema, z.iso.date()]);
const slotSchema = z.enum(["morning", "afternoon"]);

export const bookingDayOptions = demoDaySchema.options;
export const bookingSlotOptions = slotSchema.options;

const addressSchema = z
  .string()
  .trim()
  .max(240, "Use até 240 caracteres.")
  .regex(
    /\p{L}.*(?:\b\d{1,6}[a-z]?\b|\bs\s*\/\s*n\b).*\p{L}{2}/iu,
    "Informe a rua, o número e a cidade.",
  );

export const bookingSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("pickup"),
    day: daySchema,
    slot: slotSchema,
    address: addressSchema,
  }),
  z.object({
    method: z.literal("office"),
    day: daySchema,
    slot: slotSchema,
  }),
]);

export type Booking = z.infer<typeof bookingSchema>;

const bookingAddressField = z.string().max(240, "Use até 240 caracteres.");

export const bookingFormSchema = z
  .object({
    method: z.enum(["pickup", "office"]),
    day: daySchema.nullable(),
    slot: slotSchema.nullable(),
    address: bookingAddressField,
  })
  .superRefine((draft, context) => {
    if (draft.day === null) {
      context.addIssue({ code: "custom", path: ["day"], message: "Escolha um dia." });
    }

    if (draft.slot === null) {
      context.addIssue({ code: "custom", path: ["slot"], message: "Escolha um horário." });
    }

    if (draft.method === "pickup") {
      const address = addressSchema.safeParse(draft.address);

      if (!address.success) {
        context.addIssue({
          code: "custom",
          path: ["address"],
          message: address.error.issues[0]?.message ?? "Confira o endereço.",
        });
      }
    }
  });

export type BookingForm = z.input<typeof bookingFormSchema>;

export const ratingSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const responseOptions = ["Sim", "Em parte", "Não"] as const;
const responseSchema = z.enum(responseOptions);

export const exitSurveyRatings = [
  { key: "assessment", label: "Processo de desligamento" },
  { key: "managerSupport", label: "Apoio do gestor" },
  { key: "teamRespect", label: "Respeito da equipe" },
  { key: "communication", label: "Clareza da comunicação" },
  { key: "equipmentReturn", label: "Devolução de equipamentos" },
  { key: "documents", label: "Documentos e rescisão" },
] as const;

export type ExitSurveyRatingKey = (typeof exitSurveyRatings)[number]["key"];

export const feedbackTopics = [
  "Respeito na comunicação",
  "Clareza de prazos",
  "Devolução de equipamentos",
  "Apoio emocional",
  "Acesso a benefícios",
] as const;

const optionalRating = ratingSchema.nullable().default(null);

const feedbackSchema = z.object({
  anonymous: z.boolean(),
  assessment: ratingSchema.nullable(),
  clarity: responseSchema.nullable(),
  respect: responseSchema.nullable(),
  comment: z.string().trim().max(800),
  recommendation: z.number().int().min(0).max(10).nullable(),
  managerSupport: optionalRating,
  teamRespect: optionalRating,
  communication: optionalRating,
  equipmentReturn: optionalRating,
  documents: optionalRating,
  topics: z.array(z.enum(feedbackTopics)).max(feedbackTopics.length).default([]),
});

export const feedbackFormSchema = feedbackSchema
  .extend({
    recommendation: z
      .string()
      .trim()
      .regex(/^(10|[0-9])?$/, "Informe uma nota inteira de 0 a 10."),
  })
  .superRefine((value, context) => {
    if (
      value.assessment === null &&
      value.clarity === null &&
      value.respect === null &&
      !value.comment &&
      !value.recommendation
    ) {
      context.addIssue({
        code: "custom",
        message: "Responda pelo menos uma pergunta para enviar.",
      });
    }
  });

export type FeedbackForm = z.input<typeof feedbackFormSchema>;

export const departureSchema = z.object({
  handoffCompleted: z.array(z.string().max(100)).max(100),
  booking: bookingSchema.nullable(),
  examAttended: z.boolean(),
  feedback: feedbackSchema.nullable(),
});

export type Departure = z.infer<typeof departureSchema>;

export const initialDeparture: Departure = {
  handoffCompleted: [],
  booking: null,
  examAttended: false,
  feedback: null,
};
