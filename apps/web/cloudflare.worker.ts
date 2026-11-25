import { createWorkerApi, type WorkerBindings } from "@offboard/api/worker";
import start from "@tanstack/react-start/server-entry";
import { env, waitUntil } from "cloudflare:workers";
import { z } from "zod";
import { cronSchedules } from "./src/cron-schedules";
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

function cronTask(cron: string) {
  if (cron === cronSchedules.correios) {
    return { name: "Correios check", path: "/api/correios/check", method: "GET" };
  }

  if (cron === cronSchedules.drain) {
    return { name: "Background drain", path: "/api/background/drain", method: "POST" };
  }

  throw new Error(`Unknown cron schedule: ${cron}`);
}

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

  async scheduled(controller: ScheduledController) {
    const task = cronTask(controller.cron);
    const config = cronConfig.parse(env);

    const response = await handleApi(
      new Request(new URL(task.path, config.BETTER_AUTH_URL), {
        method: task.method,
        headers: { Authorization: `Bearer ${config.CRON_SECRET}` },
      }),
    );

    if (!response.ok) throw new Error(`${task.name} failed with status ${response.status}`);
  },
};
