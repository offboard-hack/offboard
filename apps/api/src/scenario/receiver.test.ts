import { expect, it } from "vitest";
import { startReceiver, waitForHit } from "./receiver.js";

const hit = { taskId: "t1", taskTitle: "Tarefa", status: "done", phase: "d0" };
const payload = { task: { id: "t1", title: "Tarefa", status: "done", phase: "d0" } };

it("records valid webhook calls and ignores the rest", async () => {
  const receiver = await startReceiver();

  try {
    await fetch(receiver.url, { method: "POST", body: JSON.stringify(payload) });
    await fetch(receiver.url, { method: "POST", body: JSON.stringify({ other: true }) });

    const broken = await fetch(receiver.url, { method: "POST", body: "not json" });

    expect(broken.status).toBe(400);
    expect(receiver.hits).toEqual([hit]);
    expect(await waitForHit(receiver, "t1", 100)).toEqual(hit);
    expect(await waitForHit(receiver, "missing", 120)).toBeUndefined();
  } finally {
    await receiver.close();
  }
});

it("waits for a hit that arrives later", async () => {
  const receiver = await startReceiver();

  try {
    const waiting = waitForHit(receiver, "t1", 2000);

    setTimeout(() => {
      void fetch(receiver.url, { method: "POST", body: JSON.stringify(payload) });
    }, 100);

    expect(await waiting).toEqual(hit);
  } finally {
    await receiver.close();
  }
});
