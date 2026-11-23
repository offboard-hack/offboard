import type { Treaty } from "@elysia/eden";
import { treaty } from "@elysia/eden";
import type { App } from "@offboard/api/contract";

export function createApiClient(baseUrl: string, options?: Parameters<typeof treaty<App>>[1]) {
  return treaty<App>(baseUrl, options);
}

export type ApiClient = ReturnType<typeof createApiClient>;

export type { Treaty };
