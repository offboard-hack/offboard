import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway, generateText, Output, type LanguageModel } from "ai";
import type { z } from "zod";

export type GenerateStructured = <T>(request: {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  file?: { data: Uint8Array; mediaType: string };
  timeoutMs?: number;
  reasoning?: "low" | "medium" | "high";
}) => Promise<T>;

export const createGenerateStructured = (model: LanguageModel) => {
  const generate: GenerateStructured = async ({
    schema,
    system,
    prompt,
    file,
    timeoutMs = 60_000,
    reasoning,
  }) => {
    const { output } = await generateText({
      model,
      instructions: system,
      ...(file
        ? {
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "file", data: file.data, mediaType: file.mediaType },
                ],
              },
            ],
          }
        : { prompt }),
      output: Output.object({ schema }),
      providerOptions: { gateway: { zeroDataRetention: true } },
      abortSignal: AbortSignal.timeout(timeoutMs),
      maxRetries: 1,
      reasoning,
    });

    return output;
  };

  return generate;
};

export const gatewayModel = (apiKey: string, modelId = "anthropic/claude-sonnet-5.5") =>
  createGateway({ apiKey })(modelId);

export const anthropicModel = (apiKey: string, modelId = "claude-sonnet-5-5") =>
  createAnthropic({ apiKey })(modelId);

export const resolveModel = (keys: { gatewayKey?: string; anthropicKey?: string }) => {
  if (keys.gatewayKey) return gatewayModel(keys.gatewayKey);

  if (keys.anthropicKey) return anthropicModel(keys.anthropicKey);

  return undefined;
};
