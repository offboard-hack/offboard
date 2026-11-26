# Job Embeddings Prefilter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Matching ranks all open jobs by embedding similarity to the résumé and sends the nearest 50 to the LLM.

**Spec:** `docs/superpowers/specs/2026-11-26-job-embeddings-design.md`.

## Global Constraints

- 100% coverage in `apps/api`, `apps/web` and `packages/db`.
- Zero code comments.
- English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Lint forbids:
  - explicit return types;
  - `as` casts;
  - `(x: unknown)` params, except `cause`;
  - test-double libraries (hand-written fakes are fine);
  - cross-feature imports. Read tables via `@offboard/db/schema` and compose in `app.ts`.
- Use oxfmt.
- Commit with hooks, never `--no-verify`.
- The only allowed workflow change is the `verify.yml` service image `postgres:16` → `pgvector/pgvector:pg16`.
- Migration 0018 is hand-written:
  1. Write the SQL.
  2. Copy the snapshot from 0017 with a new `id` and with `prevId` set to 0017's id.
  3. Add the journal entry, with `when` greater than 0017's.
  4. Cross-check with `npx drizzle-kit export`.
- Use the Drizzle pg-core `vector({ dimensions: 1024 })` column type.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only. The local Postgres 16 has pgvector 0.8.1 installed.
- Values:
  - model `@cf/baai/bge-m3`;
  - 1024 dimensions;
  - job text cut at 2,000 characters;
  - `embed_jobs` takes 100 jobs per run, in batches of 20;
  - 50 match candidates;
  - LLM batch 10 (unchanged).

## Review Focus

1. A résumé edit makes the next `compute_matches` re-embed the résumé. A stale embedding must never rank jobs for a new version.
2. Jobs without an embedding (newly synced, or a failed embed) still reach matching through the text-search top-up.
3. The `embed_jobs` loop terminates: a batch that fails to embed must not re-enqueue forever. Log it and stop. The next sync retries.
4. Rejected and closed jobs never appear among the nearest candidates.
5. Without `embed`, behaviour and tests match today's.

### Task 1: Embeddings end to end

**Files:**

- `packages/db` schema and migration 0018;
- `apps/api/src/shared/embed.ts`, containing the type `Embed = (texts: string[]) => Promise<number[][]>`, `jobEmbeddingText(job)` and `resumeEmbeddingText(content, titles)`;
- `features/matches/repository.ts`: `nearestCandidates(profileId, embedding, limit, excludeIds)`, `saveResumeEmbedding`, `resumeEmbedding(profileId)`, and the jobs-to-embed queries. Alternatively, put the job queries in `features/sources/repository.ts`, where jobs are written;
- the `embed_jobs` background kind plus its handler in `app.ts`. Enqueue it after source sync and dedupe it by subject;
- the `compute_matches` changes;
- `AppOptions.embed?: Embed`;
- `apps/api/src/worker.ts`, which maps `env.AI.run("@cf/baai/bge-m3", { text })` to `result.data`;
- `apps/web/cloudflare.config.ts`, which declares the `AI` binding when the API is configured (use the `cf/config` `bindings` helper for Workers AI);
- `.github/workflows/verify.yml`, for the image only;
- tests.

- [ ] Steps:
  - Write failing tests for Review Focus 1–5:
    - the embedding texts;
    - the nearest order by cosine distance, using a hand-written fake `embed` that returns fixed vectors;
    - the top-up;
    - the `embed_jobs` batching and re-enqueue;
    - the worker mapping.
  - Implement.
  - Run the gates: `npm run lint -- --force`, the format check, the web build, and root `npm test` at 100%.
  - Commit `feat(api): rank job candidates by embedding similarity`.

### Delivery

- [ ] Apply 0018 to production, with Samuel's OK. Then push, open one PR and merge once CI passes. After the deploy, check that `embed_jobs` filled `jobs.embedding` and that Samuel's profile has more compatible matches.
