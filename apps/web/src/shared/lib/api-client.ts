import { createApiClient } from "@offboard/api-client";
import { createIsomorphicFn } from "@tanstack/react-start";
import { createServerApiClient } from "./api-client.server";

export const getApiClient = createIsomorphicFn()
  .server(createServerApiClient)
  .client(() =>
    createApiClient(window.location.origin, {
      parseDate: false,
      fetch: { cache: "no-store", redirect: "error" },
    }),
  );
