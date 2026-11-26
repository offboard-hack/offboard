import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ObjectStorage } from "./object-storage.js";

const missing = z.object({ code: z.literal("ENOENT") });

export const diskStorage = (root: string) => {
  const base = path.resolve(root);

  const resolveKey = (key: string) => {
    const target = path.resolve(base, key);

    const unsafe =
      key.includes("..") ||
      key.includes("\\") ||
      path.isAbsolute(key) ||
      !target.startsWith(base + path.sep);

    if (unsafe) {
      throw new Error(`Invalid key: ${key}`);
    }

    return target;
  };

  const storage: ObjectStorage = {
    put: async (key, data) => {
      const target = resolveKey(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
    },
    get: async (key) => {
      try {
        return new Uint8Array(await readFile(resolveKey(key)));
      } catch (error) {
        if (missing.safeParse(error).success) return null;

        throw error;
      }
    },
    remove: async (keys) => {
      const targets = keys.map(resolveKey);
      await Promise.all(targets.map((target) => rm(target, { force: true })));
    },
    removePrefix: async (prefix) => {
      await rm(resolveKey(prefix), { recursive: true, force: true });
    },
  };

  return storage;
};
