import { describe, expect, it } from "vitest";
import { r2Storage, type R2BucketLike } from "./object-storage.ts";

const fakeBucket = (stored: string[] = []) => {
  const puts: { key: string; value: Uint8Array; contentType: string }[] = [];
  const deletes: string[][] = [];
  const gets: string[] = [];
  const bodies = new Map<string, Uint8Array>();
  const lists: { prefix: string; cursor?: string; limit?: number }[] = [];
  const objects = new Set(stored);

  const bucket: R2BucketLike = {
    put: async (key, value, options) => {
      puts.push({ key, value, contentType: options.httpMetadata.contentType });
    },
    delete: async (keys) => {
      const batch = Array.isArray(keys) ? keys : [keys];

      deletes.push(batch);

      for (const key of batch) objects.delete(key);
    },
    get: async (key) => {
      gets.push(key);

      const body = bodies.get(key);

      return body === undefined ? null : { arrayBuffer: async () => body.slice().buffer };
    },
    list: async (options) => {
      lists.push(options);

      const limit = Math.min(options.limit ?? 1000, 1000);

      const matching = [...objects]
        .filter((key) => key.startsWith(options.prefix) && key > (options.cursor ?? ""))
        .sort();

      const page = matching.slice(0, limit);

      return matching.length > limit
        ? { objects: page.map((key) => ({ key })), truncated: true, cursor: page.at(-1) }
        : { objects: page.map((key) => ({ key })), truncated: false };
    },
  };

  return { bucket, puts, deletes, lists, objects, gets, bodies };
};

describe("r2Storage", () => {
  it("stores bytes with the content type", async () => {
    const { bucket, puts } = fakeBucket();
    const data = new Uint8Array([1, 2, 3]);

    await r2Storage(bucket).put("resumes/a/b.pdf", data, "application/pdf");

    expect(puts).toEqual([{ key: "resumes/a/b.pdf", value: data, contentType: "application/pdf" }]);
  });

  it("reads the bytes of an object and returns null when it is missing", async () => {
    const { bucket, gets, bodies } = fakeBucket();

    bodies.set("ai-applications/a/b.png", new Uint8Array([9, 8, 7]));

    const storage = r2Storage(bucket);

    expect(await storage.get("ai-applications/a/b.png")).toEqual(new Uint8Array([9, 8, 7]));
    expect(await storage.get("ai-applications/a/missing.png")).toBeNull();
    expect(gets).toEqual(["ai-applications/a/b.png", "ai-applications/a/missing.png"]);
  });

  it("deletes keys in batches of 1000", async () => {
    const { bucket, deletes } = fakeBucket();
    const keys = Array.from({ length: 2500 }, (_, index) => `k${index}`);

    await r2Storage(bucket).remove(keys);

    expect(deletes.map((batch) => batch.length)).toEqual([1000, 1000, 500]);
    expect(deletes.flat()).toEqual(keys);
  });

  it("removes every object under a prefix across pages in batches of 1000", async () => {
    const owned = Array.from(
      { length: 2500 },
      (_, index) => `resumes/a/${String(index).padStart(4, "0")}.pdf`,
    );

    const others = ["resumes/b/1.pdf", "resumes/ab/1.pdf", "resumes/a"];
    const { bucket, deletes, lists, objects } = fakeBucket([...owned, ...others]);

    await r2Storage(bucket).removePrefix("resumes/a/");

    expect(lists).toHaveLength(3);
    expect(lists.every((options) => options.prefix === "resumes/a/")).toBe(true);
    expect(deletes.map((batch) => batch.length)).toEqual([1000, 1000, 500]);
    expect(deletes.flat()).toEqual(owned);
    expect([...objects]).toEqual(others);
  });

  it("does not delete when nothing is under the prefix", async () => {
    const { bucket, deletes, lists } = fakeBucket(["resumes/b/1.pdf"]);

    await r2Storage(bucket).removePrefix("resumes/a/");

    expect(lists).toHaveLength(1);
    expect(deletes).toEqual([]);
  });

  it("does nothing when there are no keys", async () => {
    const { bucket, deletes } = fakeBucket();

    await r2Storage(bucket).remove([]);

    expect(deletes).toEqual([]);
  });
});
