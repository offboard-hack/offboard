# Job Embeddings Prefilter Design

Samuel, 2026-11-26: there are 1,613 open jobs, but only 5 show as compatible for him. Matching sends just 30 candidates per résumé version to the LLM. Those 30 are picked by a lexical full-text search, so most of them are poor. He chose pgvector with Workers AI embeddings over a better lexical search, and authorized changing the CI Postgres image to `pgvector/pgvector:pg16`.

## Approaches

- **pgvector + Workers AI `@cf/baai/bge-m3` (chosen).** Each open job and each résumé version is embedded once. Postgres ranks all open jobs by cosine distance to the résumé, and the LLM scores only the top 50. It understands synonyms ("Desenvolvedor" vs "Engenheiro de Software"). It runs on the Workers AI free allocation: 10,000 neurons a day, about 9M input tokens.
- **A better lexical search:** no new infrastructure, but it still misses synonyms.
- **Vectors in `real[]` without pgvector:** this would have avoided the CI image change. Samuel authorized the change instead.

## Behaviour

- **Embedding model:** `@cf/baai/bge-m3`, which is multilingual. Vectors are 1024-dimensional, stored as `vector(1024)` and searched with cosine distance (`<=>`) by an exact scan, with no index for now.
- **Job text:** the title, company, location and work model, plus the description with tags stripped, cut at 2,000 characters.
- **Résumé text:** the target titles, the headline, the experience roles, the skills and the summary.
- **Embedding jobs:** a background job `embed_jobs` embeds up to 100 open jobs that have no embedding, in batches of 20.
  - If more remain, it enqueues itself again. When none remain, it runs the existing new-job match fan-out.
  - After every source sync, `embed_jobs` is enqueued when embeddings are configured. This also backfills the current jobs on the first syncs after deploy.
- **`compute_matches`, when embeddings are configured:**
  1. Embed the résumé text (titles, headline, roles, skills, summary) if the stored embedding was made from different text.
  2. Take the 50 nearest open jobs that have an embedding and are not rejected, then drop the ones already fresh for this version.
  3. If fewer than 50 have embeddings, top up with today's text-search candidates.
  - LLM scoring is unchanged: batches of 10, the daily LLM cap, and `compatibleScore` 50.
- **Without embeddings configured** (local dev, tests without the fake), behaviour is exactly today's.
- **Candidates per résumé version:** 30 → 50 when embeddings are configured; 30 otherwise.
- **Privacy:** résumé text is sent to Cloudflare Workers AI. Cloudflare already hosts the app, and the text already goes to Anthropic. Embeddings are derived data. They are not exported, and they are deleted with the résumé row.

## Data (migration 0018)

- `CREATE EXTENSION IF NOT EXISTS vector`.
- `jobs.embedding vector(1024) null` and `jobs.embedded_at timestamp null`, with no vector index.
- `resumes.embedding vector(1024) null` and `resumes.embedded_hash varchar(64) null`. The latter holds the SHA-256 of the exact text the embedding was made from.

## Ops

- `apps/web/cloudflare.config.ts` declares the Workers AI binding `AI` whenever the API is configured.
- `apps/api/src/worker.ts` passes `embed` into the app when `env.AI` exists.
- The CI service image changes from `postgres:16` to `pgvector/pgvector:pg16`. That is the only workflow change, and Samuel authorized it.
- Apply 0018 to production before merging. Neon has `vector` 0.8.7 available.

## Not covered

- A per-person ranked list before LLM scoring (showing raw similarity).
- Ranking by preferences inside the similarity query. The list already orders by fits, then score.
