CREATE TABLE IF NOT EXISTS "demo_profile_embeddings" (
	"slug" varchar(80) PRIMARY KEY NOT NULL,
	"embedded_hash" varchar(64) NOT NULL,
	"embedding" vector(1024) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "demo_search_usage" (
	"bucket" varchar(80) NOT NULL,
	"day" date NOT NULL,
	"searches" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "demo_search_usage_bucket_day_pk" PRIMARY KEY("bucket","day")
);
