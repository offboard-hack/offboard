import { t } from "elysia";
import { z } from "zod";

export const errorResponse = t.Object({ error: t.String() });

export const uniqueViolation = z.object({ cause: z.object({ code: z.literal("23505") }) });
