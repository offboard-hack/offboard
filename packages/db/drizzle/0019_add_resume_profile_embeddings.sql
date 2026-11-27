ALTER TABLE "resumes" ADD COLUMN "profile_embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "profile_embedded_hash" varchar(64);