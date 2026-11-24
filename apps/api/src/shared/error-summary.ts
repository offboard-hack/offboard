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
