import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText } from "./html-text.js";

describe("decodeEntities", () => {
  it("decodes the supported entities once, ampersand last", () => {
    expect(decodeEntities("&lt;p class=&quot;a&quot;&gt;it&#39;s&nbsp;&amp;lt;&lt;/p&gt;")).toBe(
      '<p class="a">it\'s &lt;</p>',
    );
  });
});

describe("htmlToText", () => {
  it("strips scripts, styles and tags and collapses whitespace", () => {
    expect(
      htmlToText(
        "<style>p{}</style><h1>Dev &amp; Ops</h1>\n\n<p>5 &lt; 6</p><script>x()</script ><p>ok",
      ),
    ).toBe("Dev & Ops 5 < 6 ok");
  });

  it("slices the text to 30 000 characters", () => {
    expect(htmlToText(`<p>${"x".repeat(40_000)}</p>`)).toBe("x".repeat(30_000));
  });
});
