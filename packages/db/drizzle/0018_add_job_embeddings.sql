CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "embedded_at" timestamp;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "embedded_version" timestamp;--> statement-breakpoint
CREATE INDEX "jobs_embedding_idx" ON "jobs" USING hnsw ("embedding" vector_cosine_ops);