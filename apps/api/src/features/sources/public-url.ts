const blockedSuffixes = [".localhost", ".local", ".internal"];
const ipv4Literal = /^\d+\.\d+\.\d+\.\d+$/;

const isPublicHostname = (hostname: string) => {
  const host = hostname.replace(/\.$/, "");

  return (
    host.includes(".") &&
    !hostname.includes("..") &&
    !host.startsWith("[") &&
    !ipv4Literal.test(host) &&
    !blockedSuffixes.some((suffix) => host.endsWith(suffix))
  );
};

export const parsePublicUrl = (raw: string) => {
  const invalid = "invalid_url" as const;

  if (!URL.canParse(raw)) return invalid;

  const url = new URL(raw);

  const allowed =
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    isPublicHostname(url.hostname);

  return allowed ? url : invalid;
};
