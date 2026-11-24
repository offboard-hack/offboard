import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diskStorage } from "./disk-storage.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "disk-storage-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const exists = async (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

describe("diskStorage", () => {
  it("writes bytes and creates nested directories", async () => {
    const storage = diskStorage(root);

    await storage.put("resumes/p/f.pdf", new Uint8Array([1, 2, 3]), "application/pdf");

    expect([...(await readFile(path.join(root, "resumes/p/f.pdf")))]).toEqual([1, 2, 3]);
  });

  it.each(["../x", "a/../../x", "/abs", "a\\b", "", "."])("rejects the key %j", async (key) => {
    const storage = diskStorage(root);

    await expect(storage.put(key, new Uint8Array(), "text/plain")).rejects.toThrow("Invalid key");
    await expect(storage.remove([key])).rejects.toThrow("Invalid key");
    await expect(storage.removePrefix(key)).rejects.toThrow("Invalid key");
  });

  it("removes existing files and ignores missing ones", async () => {
    const storage = diskStorage(root);
    await storage.put("a/b.pdf", new Uint8Array([1]), "application/pdf");

    await storage.remove(["a/b.pdf", "a/missing.pdf"]);

    expect(await exists(path.join(root, "a/b.pdf"))).toBe(false);
  });

  it("removes a prefix directory with every file in it", async () => {
    const storage = diskStorage(root);
    await storage.put("resumes/p/recorded.pdf", new Uint8Array([1]), "application/pdf");
    await storage.put("resumes/p/nested/orphan.docx", new Uint8Array([2]), "application/pdf");
    await storage.put("resumes/q/kept.pdf", new Uint8Array([3]), "application/pdf");

    await storage.removePrefix("resumes/p/");
    await storage.removePrefix("resumes/missing/");

    expect(await exists(path.join(root, "resumes/p"))).toBe(false);
    expect(await exists(path.join(root, "resumes/q/kept.pdf"))).toBe(true);
  });
});
