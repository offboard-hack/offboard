export type ObjectStorage = {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
};

export type R2BucketLike = {
  put(
    key: string,
    value: Uint8Array,
    options: { httpMetadata: { contentType: string } },
  ): Promise<object | null | void>;
  delete(keys: string | string[]): Promise<void>;
};

const BATCH_SIZE = 1000;

export const r2Storage = (bucket: R2BucketLike) => {
  const storage: ObjectStorage = {
    put: async (key, data, contentType) => {
      await bucket.put(key, data, { httpMetadata: { contentType } });
    },
    remove: async (keys) => {
      for (let start = 0; start < keys.length; start += BATCH_SIZE) {
        await bucket.delete(keys.slice(start, start + BATCH_SIZE));
      }
    },
  };

  return storage;
};
