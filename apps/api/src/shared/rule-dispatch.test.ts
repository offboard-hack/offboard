import { describe, expect, it } from "vitest";
import type { FireRules } from "./rule-dispatch.ts";
import { fireTaskStatusChanged } from "./rule-dispatch.ts";

describe("fireTaskStatusChanged", () => {
  const base = {
    orgId: "org-1",
    taskId: "task-1",
    taskTitle: "Test",
    status: "done",
  };

  function recorder() {
    const calls: unknown[] = [];

    const fire: FireRules = async (trigger, context) => {
      calls.push([trigger, context]);
    };

    return { calls, fire } satisfies { calls: unknown[]; fire: FireRules };
  }

  it("does nothing when phase is null", async () => {
    const { calls, fire } = recorder();

    await fireTaskStatusChanged(fire, { ...base, phase: null, stepId: null });

    expect(calls).toHaveLength(0);
  });

  it("fires with stepId undefined when stepId is null", async () => {
    const { calls, fire } = recorder();

    await fireTaskStatusChanged(fire, { ...base, phase: "onboarding", stepId: null });

    expect(calls).toEqual([
      [
        "task.status_changed",
        {
          orgId: "org-1",
          task: {
            id: "task-1",
            title: "Test",
            status: "done",
            phase: "onboarding",
            stepId: undefined,
          },
        },
      ],
    ]);
  });

  it("fires with stepId when present", async () => {
    const { calls, fire } = recorder();

    await fireTaskStatusChanged(fire, { ...base, phase: "onboarding", stepId: "step-1" });

    expect(calls).toEqual([
      [
        "task.status_changed",
        {
          orgId: "org-1",
          task: {
            id: "task-1",
            title: "Test",
            status: "done",
            phase: "onboarding",
            stepId: "step-1",
          },
        },
      ],
    ]);
  });
});
