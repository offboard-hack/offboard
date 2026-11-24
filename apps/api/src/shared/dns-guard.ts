const octet = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const ipv4 = new RegExp(`^${octet}\\.${octet}\\.${octet}\\.${octet}$`);

const isPrivateIpv4 = (a: number, b: number) =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  a >= 224 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168);

const ipv6Groups = (address: string) => {
  const host = new URL(`https://[${address}]`).hostname.slice(1, -1);
  const [head, tail] = host.split("::");
  const left = head === "" ? [] : head.split(":");

  if (tail === undefined) return left.map((group) => Number.parseInt(group, 16));

  const right = tail === "" ? [] : tail.split(":");
  const zeros = Array.from({ length: 8 - left.length - right.length }, () => "0");

  return [...left, ...zeros, ...right].map((group) => Number.parseInt(group, 16));
};

const isPrivateIpv6 = (groups: number[]) => {
  const [first, second, , , , sixth, seventh] = groups;
  const embedded = () => isPrivateIpv4(seventh >> 8, seventh & 0xff);

  if (groups.slice(0, 6).every((group) => group === 0)) return true;

  if (groups.slice(0, 5).every((group) => group === 0) && sixth === 0xffff) return embedded();

  if (first === 0x64 && second === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    return embedded();
  }

  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
};

export const isPrivateAddress = (address: string) => {
  const match = ipv4.exec(address);

  if (match !== null) return isPrivateIpv4(Number(match[1]), Number(match[2]));

  if (!address.includes(":") || !URL.canParse(`https://[${address}]`)) return true;

  return isPrivateIpv6(ipv6Groups(address));
};

export const createDnsGuardedFetch = (
  lookup: (hostname: string) => Promise<string[]>,
  fetchImpl: typeof fetch = fetch,
) => {
  const guarded: typeof fetch = async (input, init) => {
    const { hostname } = new URL(input instanceof Request ? input.url : input);
    const addresses = await lookup(hostname);

    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new Error(`Refusing to fetch ${hostname}: it resolves to a non-public address`);
    }

    return fetchImpl(input, init);
  };

  return guarded;
};
