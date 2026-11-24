import { createGateway, generateText, Output, type LanguageModel } from "ai";
import type { z } from "zod";

export type GenerateStructured = <T>(request: {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  file?: { data: Uint8Array; mediaType: string };
}) => Promise<T>;

export const createGenerateStructured = (model: LanguageModel) => {
  const generate: GenerateStructured = async ({ schema, system, prompt, file }) => {
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
      abortSignal: AbortSignal.timeout(60_000),
      maxRetries: 1,
    });

    return output;
  };

  return generate;
};

export const gatewayModel = (apiKey: string, modelId = "anthropic/claude-sonnet-5.5") =>
  createGateway({ apiKey })(modelId);
