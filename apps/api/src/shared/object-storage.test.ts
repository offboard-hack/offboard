import { describe, expect, it } from "vitest";
import { r2Storage, type R2BucketLike } from "./object-storage.ts";

const fakeBucket = () => {
  const puts: { key: string; value: Uint8Array; contentType: string }[] = [];
  const deletes: string[][] = [];

  const bucket: R2BucketLike = {
    put: async (key, value, options) => {
      puts.push({ key, value, contentType: options.httpMetadata.contentType });
    },
    delete: async (keys) => {
      deletes.push(Array.isArray(keys) ? keys : [keys]);
    },
  };

  return { bucket, puts, deletes };
};

describe("r2Storage", () => {
  it("stores bytes with the content type", async () => {
    const { bucket, puts } = fakeBucket();
    const data = new Uint8Array([1, 2, 3]);

    await r2Storage(bucket).put("resumes/a/b.pdf", data, "application/pdf");

    expect(puts).toEqual([{ key: "resumes/a/b.pdf", value: data, contentType: "application/pdf" }]);
  });

  it("deletes keys in batches of 1000", async () => {
    const { bucket, deletes } = fakeBucket();
    const keys = Array.from({ length: 2500 }, (_, index) => `k${index}`);

    await r2Storage(bucket).remove(keys);

    expect(deletes.map((batch) => batch.length)).toEqual([1000, 1000, 500]);
    expect(deletes.flat()).toEqual(keys);
  });

  it("does nothing when there are no keys", async () => {
    const { bucket, deletes } = fakeBucket();

    await r2Storage(bucket).remove([]);

    expect(deletes).toEqual([]);
  });
});
