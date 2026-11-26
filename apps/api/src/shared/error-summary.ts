import { z } from "zod";

const causeCode = z.object({ cause: z.object({ code: z.string() }) });

const ownCode = z.object({ code: z.string() });

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
  const nested = causeCode.safeParse(cause);
  const own = ownCode.safeParse(cause);
  const name = cause instanceof Error ? cause.name : "Unknown";

  if (nested.success) return { name, code: nested.data.cause.code };

  return own.success ? { name, code: own.data.code } : { name };
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
