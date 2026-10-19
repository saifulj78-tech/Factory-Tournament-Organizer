CREATE TABLE IF NOT EXISTS "ladder_participants" (
  "id" serial PRIMARY KEY NOT NULL,
  "tournament_id" integer NOT NULL REFERENCES "tournament"("id") ON DELETE CASCADE,
  "seed" integer,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ladder_participants_tournament_idx"
  ON "ladder_participants" USING btree ("tournament_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ladder_participants_tournament_seed_idx"
  ON "ladder_participants" USING btree ("tournament_id", "seed");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ladder_courts" (
  "id" serial PRIMARY KEY NOT NULL,
  "tournament_id" integer NOT NULL REFERENCES "tournament"("id") ON DELETE CASCADE,
  "court_number" integer NOT NULL,
  "queue_player_ids" integer[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ladder_courts_tournament_court_idx"
  ON "ladder_courts" USING btree ("tournament_id", "court_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ladder_games" (
  "id" serial PRIMARY KEY NOT NULL,
  "tournament_id" integer NOT NULL REFERENCES "tournament"("id") ON DELETE CASCADE,
  "batch_number" integer NOT NULL,
  "court_number" integer NOT NULL,
  "home_player_one_id" integer NOT NULL REFERENCES "ladder_participants"("id"),
  "home_player_two_id" integer NOT NULL REFERENCES "ladder_participants"("id"),
  "away_player_one_id" integer NOT NULL REFERENCES "ladder_participants"("id"),
  "away_player_two_id" integer NOT NULL REFERENCES "ladder_participants"("id"),
  "home_score" integer,
  "away_score" integer,
  "played" boolean DEFAULT false NOT NULL,
  "winner_movement" text,
  "loser_movement" text,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ladder_games_tournament_batch_court_idx"
  ON "ladder_games" USING btree ("tournament_id", "batch_number", "court_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ladder_games_tournament_batch_idx"
  ON "ladder_games" USING btree ("tournament_id", "batch_number");