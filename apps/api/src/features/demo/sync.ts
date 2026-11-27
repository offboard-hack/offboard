import {
  profileEmbeddingText,
  textHash,
  type Embed,
  type ProfileText,
} from "../../shared/embed.js";
import { demoProfiles } from "./profiles.js";
import type { DemoRepository } from "./repository.js";

const batchSize = 20;

export async function syncDemoEmbeddings(
  repo: DemoRepository,
  embed: Embed,
  profiles: readonly { slug: string; content: ProfileText }[] = demoProfiles,
) {
  const known = new Map((await repo.stored()).map((row) => [row.slug, row.hash]));

  const texts = await Promise.all(
    profiles.map(async (profile) => {
      const text = profileEmbeddingText(profile.content);

      return { slug: profile.slug, text, hash: await textHash(text) };
    }),
  );

  const stale = texts.filter((entry) => known.get(entry.slug) !== entry.hash);

  for (let start = 0; start < stale.length; start += batchSize) {
    const part = stale.slice(start, start + batchSize);
    const vectors = await embed(part.map((entry) => entry.text));

    await repo.save(
      part.map((entry, index) => ({
        slug: entry.slug,
        hash: entry.hash,
        embedding: vectors[index],
      })),
    );
  }

  await repo.keepOnly(profiles.map((profile) => profile.slug));

  return stale.length;
}
