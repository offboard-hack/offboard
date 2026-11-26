export type ObjectStorage = {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(keys: string[]): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
};

export type R2BucketLike = {
  put(
    key: string,
    value: Uint8Array,
    options: { httpMetadata: { contentType: string } },
  ): Promise<object | null | void>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }>;
};

const BATCH_SIZE = 1000;

export const r2Storage = (bucket: R2BucketLike) => {
  const storage: ObjectStorage = {
    put: async (key, data, contentType) => {
      await bucket.put(key, data, { httpMetadata: { contentType } });
    },
    get: async (key) => {
      const object = await bucket.get(key);

      return object === null ? null : new Uint8Array(await object.arrayBuffer());
    },
    remove: async (keys) => {
      for (let start = 0; start < keys.length; start += BATCH_SIZE) {
        await bucket.delete(keys.slice(start, start + BATCH_SIZE));
      }
    },
    removePrefix: async (prefix) => {
      let cursor: string | undefined;

      do {
        const page = await bucket.list({ prefix, cursor, limit: BATCH_SIZE });
        const keys = page.objects.map((object) => object.key);

        if (keys.length > 0) await bucket.delete(keys);

        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    },
  };

  return storage;
};
