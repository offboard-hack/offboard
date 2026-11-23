import { z } from "zod";

export const listPageSizes = [5, 10, 25, 50] as const;

const page = z.number().int().positive().optional().catch(undefined);
const pageSize = z.literal(listPageSizes).optional().catch(undefined);

export const listSearchSchema = z.object({ page, pageSize });

export const defaultListPageSize = 10;
