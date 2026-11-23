export function safeReturnPath(value: string | undefined) {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\s]/u.test(value) ||
    value.split(/[?#]/, 1)[0] === "/entrar"
  ) {
    return "/desligamentos";
  }

  return value;
}
