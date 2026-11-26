import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGenerateStructured, gatewayModel } from "./ai.ts";

const jsonModel = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  });

describe("createGenerateStructured", () => {
  it("returns the parsed object and requests zero data retention", async () => {
    const model = jsonModel('{"title":"x"}');

    const output = await createGenerateStructured(model)({
      schema: z.object({ title: z.string() }),
      system: "s",
      prompt: "p",
    });

    expect(output).toEqual({ title: "x" });
    expect(model.doGenerateCalls).toHaveLength(1);
    const [call] = model.doGenerateCalls;
    expect(call?.providerOptions?.gateway?.zeroDataRetention).toBe(true);
    expect(call?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call?.abortSignal?.aborted).toBe(false);
    expect(call?.prompt).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: [{ type: "text", text: "p" }] },
    ]);
  });

  it("sends the file as a document part next to the prompt", async () => {
    const model = jsonModel('{"title":"x"}');
    const data = new Uint8Array([37, 80, 68, 70]);

    await createGenerateStructured(model)({
      schema: z.object({ title: z.string() }),
      system: "s",
      prompt: "p",
      file: { data, mediaType: "application/pdf" },
    });

    const [call] = model.doGenerateCalls;
    expect(call?.prompt).toEqual([
      { role: "system", content: "s" },
      {
        role: "user",
        content: [
          { type: "text", text: "p" },
          {
            type: "file",
            data: { type: "data", data },
            mediaType: "application/pdf",
          },
        ],
      },
    ]);
  });

  it("bounds the call to 60 seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await createGenerateStructured(jsonModel('{"title":"x"}'))({
      schema: z.object({ title: z.string() }),
      system: "s",
      prompt: "p",
    });

    expect(timeout).toHaveBeenCalledWith(60_000);

    timeout.mockRestore();
  });

  it("retries a failed call once", async () => {
    let attempts = 0;

    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        attempts += 1;

        throw new APICallError({
          message: "overloaded",
          url: "https://gateway.test",
          requestBodyValues: {},
          statusCode: 529,
          isRetryable: true,
        });
      },
    });

    await expect(
      createGenerateStructured(model)({
        schema: z.object({ title: z.string() }),
        system: "s",
        prompt: "p",
      }),
    ).rejects.toThrow("overloaded");
    expect(attempts).toBe(2);
  });

  it("rejects output that does not match the schema", async () => {
    const generate = createGenerateStructured(jsonModel('{"title":1}'));

    await expect(
      generate({ schema: z.object({ title: z.string() }), system: "s", prompt: "p" }),
    ).rejects.toThrow();
  });
});

describe("gatewayModel", () => {
  it("defaults to Claude Sonnet 5.5", () => {
    expect(gatewayModel("key").modelId).toBe("anthropic/claude-sonnet-5.5");
  });

  it("accepts another model id", () => {
    expect(gatewayModel("key", "anthropic/claude-haiku-5").modelId).toBe(
      "anthropic/claude-haiku-5",
    );
  });
});
