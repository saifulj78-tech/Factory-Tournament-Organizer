ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "knockout_matches" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;