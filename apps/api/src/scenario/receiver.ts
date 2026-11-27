import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";

const hit = z.object({
  taskId: z.string(),
  taskTitle: z.string(),
  status: z.string(),
  phase: z.string(),
});

export type Hit = z.infer<typeof hit>;

export type Receiver = { url: string; hits: Hit[]; close(): Promise<void> };

export async function startReceiver() {
  const hits: Hit[] = [];

  const server = createServer((request, response) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      try {
        const parsed = hit.safeParse(JSON.parse(body));

        if (parsed.success) hits.push(parsed.data);
      } catch {
        response.statusCode = 400;
      }

      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = z
    .object({ port: z.number() })
    .parse(server.address() satisfies AddressInfo | string | null);

  return {
    url: `http://127.0.0.1:${port}/hooks/offboard`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  } satisfies Receiver;
}

export async function waitForHit(receiver: Receiver, taskId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const found = receiver.hits.find((item) => item.taskId === taskId);

    if (found || Date.now() >= deadline) return found;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
