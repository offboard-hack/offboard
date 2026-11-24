import { createGateway, generateText, Output, type LanguageModel } from "ai";
import type { z } from "zod";

export type GenerateStructured = <T>(request: {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
}) => Promise<T>;

export const createGenerateStructured = (model: LanguageModel) => {
  const generate: GenerateStructured = async ({ schema, system, prompt }) => {
    const { output } = await generateText({
      model,
      instructions: system,
      prompt,
      output: Output.object({ schema }),
      providerOptions: { gateway: { zeroDataRetention: true } },
    });

    return output;
  };

  return generate;
};

export const gatewayModel = (apiKey: string, modelId = "anthropic/claude-sonnet-5.5") =>
  createGateway({ apiKey })(modelId);
