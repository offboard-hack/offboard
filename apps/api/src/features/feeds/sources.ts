import { z } from "zod";
import { decodeEntities, htmlToText } from "../../shared/html-text.js";
import { parsePublicUrl } from "../../shared/page-text.js";
import { discardBody, readCapped } from "../../shared/response-body.js";
import { sanitizeText, storableClip } from "../../shared/storable-text.js";
import { mentionsBrazil, parseLocation, workModelFrom } from "./normalize.js";

export type FeedJob = {
  sourceKey: string;
  title: string;
  company: string;
  workModel: "remote" | "hybrid" | "onsite" | null;
  city: string | null;
  state: string | null;
  url: string;
  description: string;
  postedAt: Date | null;
};

export type FeedResult =
  | { jobs: FeedJob[]; skipped: number }
  | { error: "http_error" | "invalid_json" | "timeout" | "network" | "too_large"; status?: number };

type Feed = { provider: "greenhouse" | "lever"; board: string; companyLabel: string | null };

type Place = ReturnType<typeof parseLocation>;

const maxBytes = 10_000_000;
const timeoutMs = 15_000;
const fieldLimit = 255;
const descriptionLimit = 20_000;
const locationLimit = 1_000;

const jsonText = z.string().transform((text, context) => {
  try {
    return JSON.parse(text);
  } catch {
    context.addIssue({ code: "custom", message: "invalid_json" });

    return z.NEVER;
  }
});

const title = z
  .string()
  .transform((value) => storableClip(value, fieldLimit))
  .pipe(z.string().min(1));

const publicUrl = z.string().transform((value, context) => {
  const url = parsePublicUrl(value);

  if (url !== "invalid_url") return url.href;

  context.addIssue({ code: "custom", message: "invalid_url" });

  return z.NEVER;
});

const lenientText = z.string().catch("");

const greenhouseFeed = jsonText.pipe(z.object({ jobs: z.array(z.unknown()) }));

const greenhouseJob = z.object({
  id: z.number().int().nonnegative(),
  title,
  company_name: lenientText,
  absolute_url: publicUrl,
  location: z.object({ name: lenientText }).catch({ name: "" }),
  first_published: lenientText,
  content: lenientText,
});

const leverFeed = jsonText.pipe(z.array(z.unknown()));

const leverPosting = z.object({
  id: z.string().trim().min(1).max(fieldLimit),
  text: title,
  hostedUrl: publicUrl,
  categories: z
    .object({ location: lenientText, allLocations: z.array(z.string()).catch([]) })
    .catch({ location: "", allLocations: [] }),
  workplaceType: lenientText,
  country: lenientText,
  createdAt: z.number().catch(Number.NaN),
  descriptionPlain: lenientText,
  additionalPlain: lenientText,
});

const validDate = (date: Date) => (Number.isNaN(date.getTime()) ? null : date);

const titleCase = (board: string) =>
  board
    .split(/[-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const companyOf = (feed: Feed, named: string) =>
  storableClip(feed.companyLabel ?? "", fieldLimit) ||
  storableClip(named, fieldLimit) ||
  storableClip(titleCase(feed.board), fieldLimit);

const placeOf = (text: string) => parseLocation(sanitizeText(text).slice(0, locationLimit));

const located = (place: Place) => ({
  city: place.city === null ? null : storableClip(place.city, fieldLimit),
  state: place.state,
});

const collect = <Item, Parsed>(
  items: Item[],
  schema: z.ZodType<Parsed>,
  toJob: (parsed: Parsed) => FeedJob | null,
) => {
  const jobs: FeedJob[] = [];
  let skipped = 0;

  for (const item of items) {
    const parsed = schema.safeParse(item);

    if (!parsed.success) {
      skipped += 1;

      continue;
    }

    const job = toJob(parsed.data);

    if (job !== null) jobs.push(job);
  }

  return { jobs, skipped } satisfies FeedResult;
};

const readGreenhouse = (text: string, feed: Feed) => {
  const parsed = greenhouseFeed.safeParse(text);

  if (!parsed.success) return { error: "invalid_json" } satisfies FeedResult;

  return collect(parsed.data.jobs, greenhouseJob, (job) => {
    const place = placeOf(job.location.name);

    if (!place.inBrazil) return null;

    return {
      sourceKey: `${feed.board}:${job.id}`,
      title: job.title,
      company: companyOf(feed, job.company_name),
      workModel: workModelFrom(`${job.title} ${job.location.name}`),
      ...located(place),
      url: job.absolute_url,
      description: storableClip(htmlToText(decodeEntities(job.content)), descriptionLimit),
      postedAt: validDate(new Date(job.first_published)),
    } satisfies FeedJob;
  });
};

const leverModel = (workplaceType: string, fallback: string) =>
  workplaceType === "remote" || workplaceType === "hybrid" || workplaceType === "onsite"
    ? workplaceType
    : workplaceType === "on-site"
      ? ("onsite" as const)
      : workModelFrom(fallback);

const readLever = (text: string, feed: Feed) => {
  const parsed = leverFeed.safeParse(text);

  if (!parsed.success) return { error: "invalid_json" } satisfies FeedResult;

  return collect(parsed.data, leverPosting, (posting) => {
    const { location, allLocations } = posting.categories;
    const country = posting.country.trim().toUpperCase();
    const foreign = country !== "" && country !== "BR";
    const candidates = [location, ...allLocations];

    const eligible = foreign
      ? candidates.filter((candidate) => mentionsBrazil(candidate))
      : candidates;

    const place =
      eligible.map((candidate) => placeOf(candidate)).find((candidate) => candidate.inBrazil) ??
      placeOf(country === "BR" ? `${location}, Brasil` : "");

    if (!place.inBrazil) return null;

    const description = `${posting.descriptionPlain.trim()}\n\n${posting.additionalPlain.trim()}`;

    return {
      sourceKey: `${feed.board}:${posting.id}`,
      title: posting.text,
      company: companyOf(feed, ""),
      workModel: leverModel(posting.workplaceType, `${posting.text} ${location}`),
      ...located(place),
      url: posting.hostedUrl,
      description: storableClip(description, descriptionLimit),
      postedAt: validDate(new Date(posting.createdAt)),
    } satisfies FeedJob;
  });
};

const sources = {
  greenhouse: {
    url: (board: string) =>
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
    read: readGreenhouse,
  },
  lever: {
    url: (board: string) =>
      `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`,
    read: readLever,
  },
};

const download = async (url: string, fetchImpl: typeof fetch) => {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      await discardBody(response);

      return { error: "http_error", status: response.status } satisfies FeedResult;
    }

    if (Number(response.headers.get("content-length")) > maxBytes) {
      await discardBody(response);

      return { error: "too_large" } satisfies FeedResult;
    }

    const text = response.body === null ? "" : await readCapped(response.body, maxBytes);

    return text === null ? ({ error: "too_large" } satisfies FeedResult) : { text };
  } catch (cause) {
    const timedOut =
      cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");

    return { error: timedOut ? "timeout" : "network" } satisfies FeedResult;
  }
};

export const fetchFeed = async (feed: Feed, fetchImpl: typeof fetch = fetch) => {
  const source = sources[feed.provider];
  const downloaded = await download(source.url(feed.board), fetchImpl);

  if ("error" in downloaded) return downloaded;

  return source.read(downloaded.text, feed);
};
