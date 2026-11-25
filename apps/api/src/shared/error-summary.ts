import { z } from "zod";

const causeCode = z.object({ cause: z.object({ code: z.string() }) });

export function errorSummary(cause: unknown) {
  return cause instanceof Error
    ? { name: cause.name, message: cause.message }
    : { name: "Unknown", message: String(cause) };
}

export function logFailure(context: string) {
  return (cause: unknown) => {
    console.error(context, errorSummary(cause));

    return undefined;
  };
}

function codeSummary(cause: unknown) {
  const code = causeCode.safeParse(cause);
  const name = cause instanceof Error ? cause.name : "Unknown";

  return code.success ? { name, code: code.data.cause.code } : { name };
}

export function logUnhandled(cause: unknown) {
  console.error("unhandled error", codeSummary(cause));
}

export function logFailureCode(context: string) {
  return (cause: unknown) => {
    console.error(context, codeSummary(cause));

    return undefined;
  };
}
