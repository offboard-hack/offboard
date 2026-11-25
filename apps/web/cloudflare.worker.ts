import { createWorkerApi, type WorkerBindings } from "@offboard/api/worker";
import start from "@tanstack/react-start/server-entry";
import { env, waitUntil } from "cloudflare:workers";
import { z } from "zod";
import { apiTransport } from "./src/shared/lib/api-transport.server";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerBindings {}
  }
}

const handleApi = createWorkerApi(env, waitUntil);

const cronConfig = z.object({
  BETTER_AUTH_URL: z.url(),
  CRON_SECRET: z.string().min(1),
});

export default {
  fetch(request: Request) {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      return handleApi(request);
    }

    const fetchApi: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      const ip = request.headers.get("cf-connecting-ip");

      if (ip) headers.set("cf-connecting-ip", ip);

      const apiRequest = new Request(input, {
        method: init?.method,
        body: init?.body,
        headers,
        signal: init?.signal,
      });

      return handleApi(apiRequest);
    };

    return apiTransport.run(fetchApi, () => start.fetch(request));
  },

  async scheduled() {
    const config = cronConfig.parse(env);

    const response = await handleApi(
      new Request(new URL("/api/correios/check", config.BETTER_AUTH_URL), {
        headers: { Authorization: `Bearer ${config.CRON_SECRET}` },
      }),
    );

    if (!response.ok) throw new Error(`Correios check failed with status ${response.status}`);
  },
};
