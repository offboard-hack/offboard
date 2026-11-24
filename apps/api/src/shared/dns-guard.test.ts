import { describe, expect, it } from "vitest";
import { createDnsGuardedFetch, isPrivateAddress } from "./dns-guard.ts";
import { fetchPageText } from "./page-text.ts";

const recordingFetch = (...responses: Response[]) => {
  const calls: string[] = [];

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(
      `${init?.redirect ?? "follow"} ${input instanceof Request ? input.url : String(input)}`,
    );

    const next = responses.shift();

    if (next === undefined) throw new Error("unexpected fetch");

    return next;
  };

  return { calls, fetchImpl };
};

const resolver = (entries: [string, string[]][]) => {
  const table = new Map(entries);
  const lookups: string[] = [];

  const lookup = async (hostname: string) => {
    lookups.push(hostname);

    return table.get(hostname) ?? [];
  };

  return { lookup, lookups };
};

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0",
    "0.255.1.1",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "FE80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::10.0.0.1",
    "64:ff9b::10.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "ff02::1",
    "fe80::1%eth0",
    "256.1.1.1",
    "1.2.3",
    "01.2.3.4",
    "example.com",
    "",
    "garbage",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "100.63.255.255",
    "100.128.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "192.167.1.1",
    "169.253.1.1",
    "223.255.255.255",
    "11.0.0.1",
    "2606:4700:4700::1111",
    "2001:db8:1:2:3:4:5:6",
    "2a00:1450:4001:80b::200e",
    "fbff::1",
    "fec0::1",
    "::ffff:93.184.216.34",
    "64:ff9b::8.8.8.8",
  ])("treats %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("createDnsGuardedFetch", () => {
  it.each([
    [["127.0.0.1"]],
    [["93.184.216.34", "10.0.0.1"]],
    [["2606:4700:4700::1111", "::1"]],
    [[]],
  ])("refuses to fetch a host resolving to %j", async (addresses) => {
    const { calls, fetchImpl } = recordingFetch(new Response("ok"));
    const { lookup, lookups } = resolver([["jobs.example.com", addresses]]);

    const guarded = createDnsGuardedFetch(lookup, fetchImpl);

    await expect(guarded("https://jobs.example.com/a")).rejects.toThrow("jobs.example.com");
    expect(lookups).toEqual(["jobs.example.com"]);
    expect(calls).toHaveLength(0);
  });

  it("delegates unchanged when every address is public", async () => {
    const first = new Response("a");
    const second = new Response("b");
    const { calls, fetchImpl } = recordingFetch(first, second);

    const { lookup, lookups } = resolver([
      ["jobs.example.com", ["93.184.216.34", "2606:4700:4700::1111"]],
    ]);

    const guarded = createDnsGuardedFetch(lookup, fetchImpl);

    expect(await guarded(new URL("https://jobs.example.com/a"), { redirect: "manual" })).toBe(
      first,
    );
    expect(await guarded(new Request("https://jobs.example.com/b"))).toBe(second);
    expect(lookups).toEqual(["jobs.example.com", "jobs.example.com"]);
    expect(calls).toEqual([
      "manual https://jobs.example.com/a",
      "follow https://jobs.example.com/b",
    ]);
  });

  it("propagates a failed lookup without fetching", async () => {
    const { calls, fetchImpl } = recordingFetch(new Response("ok"));

    const guarded = createDnsGuardedFetch(async () => {
      throw new Error("ENOTFOUND");
    }, fetchImpl);

    await expect(guarded("https://jobs.example.com/a")).rejects.toThrow("ENOTFOUND");
    expect(calls).toHaveLength(0);
  });

  it("defaults to the global fetch", async () => {
    const guarded = createDnsGuardedFetch(async () => ["127.0.0.1"]);

    await expect(guarded("https://jobs.example.com/a")).rejects.toThrow("jobs.example.com");
  });

  it("stops fetchPageText at a redirect to a host that resolves privately", async () => {
    const { calls, fetchImpl } = recordingFetch(
      new Response(null, { status: 302, headers: { location: "https://rebind.example.net/" } }),
      new Response("<p>secret</p>", { headers: { "content-type": "text/html" } }),
    );

    const { lookup, lookups } = resolver([
      ["short.link", ["93.184.216.34"]],
      ["rebind.example.net", ["169.254.169.254"]],
    ]);

    const result = await fetchPageText(
      new URL("https://short.link/x"),
      createDnsGuardedFetch(lookup, fetchImpl),
    );

    expect(result).toBe("unreachable");
    expect(lookups).toEqual(["short.link", "rebind.example.net"]);
    expect(calls).toEqual(["manual https://short.link/x"]);
  });
});
