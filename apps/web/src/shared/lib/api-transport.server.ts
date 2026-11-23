import { AsyncLocalStorage } from "node:async_hooks";

export const apiTransport = new AsyncLocalStorage<typeof fetch>();
