import { describe, expect, it } from "vitest";
import { fetchPageText, parsePublicUrl } from "./page-text.ts";

const recordingFetch = (...responses: Response[]) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });

    const next = responses.shift();

    if (next === undefined) throw new Error(`unexpected fetch of ${String(input)}`);

    return next;
  };

  return { calls, fetchImpl };
};

const html = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

const start = new URL("https://jobs.example.com/a");

describe("parsePublicUrl", () => {
  it("accepts a public https url", () => {
    expect(parsePublicUrl("https://jobs.example.com/a")).toEqual(
      new URL("https://jobs.example.com/a"),
    );
  });

  it("accepts the explicit default port", () => {
    expect(parsePublicUrl("https://jobs.example.com:443/a")).toEqual(
      new URL("https://jobs.example.com/a"),
    );
  });

  it.each([
    "http://jobs.example.com/a",
    "https://user:pw@x.com",
    "https://user@x.com",
    "https://x.com:8443",
    "https://localhost",
    "https://localhost./",
    "https://localhost..",
    "https://x.internal..",
    "https://127.0.0.1..",
    "https://127.1..",
    "https://10.1..",
    "https://0x7f.0.0.1..",
    "https://jobs..example.com",
    "https://loc%61lhost",
    "https://app.localhost",
    "https://printer.local",
    "https://db.internal",
    "https://x.internal./",
    "https://intranet",
    "https://10.0.0.1",
    "https://169.254.169.254",
    "https://127.0.0.1",
    "https://0x7f.1",
    "https://2130706433",
    "https://8.8.8.8",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "ftp://jobs.example.com",
    "not a url",
  ])("rejects %s", (raw) => {
    expect(parsePublicUrl(raw)).toBe("invalid_url");
  });
});

describe("fetchPageText", () => {
  it("extracts readable text from an html page", async () => {
    const { calls, fetchImpl } = recordingFetch(
      html(
        "<html><head><style>body { color: red }</style><script>alert(1)</script></head>" +
          "<body><h1>Dev &amp; Ops</h1>\n\n<p>5 &lt; 6 &gt; 4 &quot;q&quot; it&#39;s&nbsp;ok</p>" +
          "<p>&amp;lt;b&amp;gt;</p><SCRIPT type='x'>evil()</SCRIPT ></body></html>",
      ),
    );

    const result = await fetchPageText(start, fetchImpl);

    expect(result).toEqual({ url: start, text: 'Dev & Ops 5 < 6 > 4 "q" it\'s ok &lt;b&gt;' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://jobs.example.com/a");
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("drops everything after an unclosed script or tag", async () => {
    const { fetchImpl } = recordingFetch(
      html("<p>Role</p><script>let a = 1"),
      html("<p>Role</p> <a href"),
    );

    expect(await fetchPageText(start, fetchImpl)).toEqual({ url: start, text: "Role" });
    expect(await fetchPageText(start, fetchImpl)).toEqual({ url: start, text: "Role" });
  });

  it("slices the text to 30 000 characters", async () => {
    const { fetchImpl } = recordingFetch(html(`<p>${"x".repeat(40_000)}</p>`));

    const result = await fetchPageText(start, fetchImpl);

    expect(result).toEqual({ url: start, text: "x".repeat(30_000) });
  });

  it("returns empty text for an html response without a body", async () => {
    const { fetchImpl } = recordingFetch(html(null));

    expect(await fetchPageText(start, fetchImpl)).toEqual({ url: start, text: "" });
  });

  it("revalidates the initial url without fetching", async () => {
    const { calls, fetchImpl } = recordingFetch();

    expect(await fetchPageText(new URL("http://10.0.0.1/"), fetchImpl)).toBe("invalid_url");
    expect(await fetchPageText(new URL("https://169.254.169.254/"))).toBe("invalid_url");
    expect(calls).toHaveLength(0);
  });

  it("rejects redirects to private or non-https targets", async () => {
    for (const location of [
      "http://169.254.169.254/",
      "https://169.254.169.254/latest/meta-data",
      "//169.254.169.254/",
      "https://localhost/admin",
      "http://jobs.example.com/b",
      "https://[",
    ]) {
      const { calls, fetchImpl } = recordingFetch(redirect(location));

      expect(await fetchPageText(new URL("https://short.link/x"), fetchImpl)).toBe("invalid_url");
      expect(calls).toHaveLength(1);
    }
  });

  it("follows a public redirect and resolves relative locations against the current url", async () => {
    const { calls, fetchImpl } = recordingFetch(
      redirect("https://jobs.example.com/posts/1"),
      redirect("../careers/2?ref=x"),
      html("<p>Engineer</p>"),
    );

    const result = await fetchPageText(new URL("https://short.link/x"), fetchImpl);

    expect(result).toEqual({
      url: new URL("https://jobs.example.com/careers/2?ref=x"),
      text: "Engineer",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://short.link/x",
      "https://jobs.example.com/posts/1",
      "https://jobs.example.com/careers/2?ref=x",
    ]);
  });

  it("follows at most three redirects", async () => {
    const { calls, fetchImpl } = recordingFetch(
      redirect("https://jobs.example.com/1"),
      redirect("https://jobs.example.com/2"),
      redirect("https://jobs.example.com/3"),
      redirect("https://jobs.example.com/4"),
      html("<p>never</p>"),
    );

    expect(await fetchPageText(start, fetchImpl)).toBe("unreachable");
    expect(calls).toHaveLength(4);
  });

  it("treats a redirect without a location as unreachable", async () => {
    const { fetchImpl } = recordingFetch(new Response(null, { status: 301 }));

    expect(await fetchPageText(start, fetchImpl)).toBe("unreachable");
  });

  it("treats a non-2xx response as unreachable", async () => {
    const { fetchImpl } = recordingFetch(
      new Response("boom", { status: 500, headers: { "content-type": "text/html" } }),
    );

    expect(await fetchPageText(start, fetchImpl)).toBe("unreachable");
  });

  it("treats a failed or timed out fetch as unreachable", async () => {
    const fetchImpl = async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };

    expect(await fetchPageText(start, fetchImpl)).toBe("unreachable");
  });

  it("treats a body that fails mid-stream as unreachable", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<p>partial"));
        controller.error(new DOMException("The operation timed out.", "TimeoutError"));
      },
    });

    const { fetchImpl } = recordingFetch(html(body));

    expect(await fetchPageText(start, fetchImpl)).toBe("unreachable");
  });

  it.each([["application/pdf"], ["text/plain"], ["application/xhtml+xml"]])(
    "rejects %s as not html",
    async (contentType) => {
      const { fetchImpl } = recordingFetch(
        new Response("%PDF", { headers: { "content-type": contentType } }),
      );

      expect(await fetchPageText(start, fetchImpl)).toBe("not_html");
    },
  );

  it("rejects a response without a content type as not html", async () => {
    const { fetchImpl } = recordingFetch(new Response(new Uint8Array([1, 2, 3])));

    expect(await fetchPageText(start, fetchImpl)).toBe("not_html");
  });

  it("accepts an uppercase html content type", async () => {
    const { fetchImpl } = recordingFetch(
      new Response("<b>ok</b>", { headers: { "content-type": "TEXT/HTML" } }),
    );

    expect(await fetchPageText(start, fetchImpl)).toEqual({ url: start, text: "ok" });
  });

  it("rejects a declared content length over the cap", async () => {
    const { fetchImpl } = recordingFetch(html("<p>small</p>", { "content-length": "3000000" }));

    expect(await fetchPageText(start, fetchImpl)).toBe("too_large");
  });

  it("stops reading a streamed body once it passes the cap", async () => {
    let pulls = 0;
    let cancelled = false;

    const chunk = new Uint8Array(1_000_000).fill(0x61);

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });

    const { fetchImpl } = recordingFetch(html(body));

    expect(await fetchPageText(start, fetchImpl)).toBe("too_large");
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(5);
  });

  it("accepts a body of exactly the cap", async () => {
    const { fetchImpl } = recordingFetch(
      html("a".repeat(2_000_000), { "content-length": "2000000" }),
    );

    const result = await fetchPageText(start, fetchImpl);

    expect(result).toEqual({ url: start, text: "a".repeat(30_000) });
  });
});
