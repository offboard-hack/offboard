CREATE TABLE "public_page_daily_views" (
	"profile_id" uuid NOT NULL,
	"day" date NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"recruiter_visits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "public_page_daily_views_profile_id_day_pk" PRIMARY KEY("profile_id","day"),
	CONSTRAINT "public_page_daily_views_counts" CHECK ("public_page_daily_views"."visits" >= 0 and "public_page_daily_views"."recruiter_visits" >= 0 and "public_page_daily_views"."recruiter_visits" <= "public_page_daily_views"."visits")
);
--> statement-breakpoint
CREATE TABLE "public_pages" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(40) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"resume_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "public_pages_slug_format" CHECK ("public_pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("public_pages"."slug") between 3 and 40)
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "public_token" varchar(64);--> statement-breakpoint
ALTER TABLE "public_page_daily_views" ADD CONSTRAINT "public_page_daily_views_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_pages" ADD CONSTRAINT "public_pages_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_pages" ADD CONSTRAINT "public_pages_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_pages_slug_idx" ON "public_pages" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_public_token_idx" ON "applications" USING btree ("public_token");
