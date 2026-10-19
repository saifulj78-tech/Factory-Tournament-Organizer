DO $$ BEGIN
  CREATE TYPE "team_event_match_type" AS ENUM (
    'mens_singles',
    'womens_singles',
    'mens_doubles',
    'womens_doubles',
    'mixed_doubles'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "team_event_stage" AS ENUM ('group', 'knockout');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "team_event_gender" AS ENUM ('male', 'female');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_event_configs" (
  "id" serial PRIMARY KEY NOT NULL,
  "tournament_id" integer NOT NULL REFERENCES "tournament"("id") ON DELETE CASCADE,
  "min_men" integer DEFAULT 3 NOT NULL,
  "min_women" integer DEFAULT 1 NOT NULL,
  "dreambreaker_enabled" boolean DEFAULT false NOT NULL,
  CONSTRAINT "team_event_configs_minimums_nonnegative"
    CHECK ("min_men" >= 0 AND "min_women" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_event_configs_tournament_unique"
  ON "team_event_configs" USING btree ("tournament_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_event_rubber_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "tournament_id" integer NOT NULL REFERENCES "tournament"("id") ON DELETE CASCADE,
  "stage" "team_event_stage" NOT NULL,
  "rubber_order" integer NOT NULL,
  "match_type" "team_event_match_type" NOT NULL,
  "target_points" integer DEFAULT 21 NOT NULL,
  "best_of" integer DEFAULT 1 NOT NULL,
  "disallow_same_male_from_previous_mixed" boolean DEFAULT false NOT NULL,
  CONSTRAINT "team_event_templates_valid_order" CHECK ("rubber_order" >= 1),
  CONSTRAINT "team_event_templates_valid_target" CHECK ("target_points" IN (15, 21)),
  CONSTRAINT "team_event_templates_valid_best_of" CHECK ("best_of" IN (1, 3))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_event_templates_stage_order_unique"
  ON "team_event_rubber_templates" USING btree ("tournament_id", "stage", "rubber_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_event_templates_tournament_stage_idx"
  ON "team_event_rubber_templates" USING btree ("tournament_id", "stage");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_event_roster_players" (
  "id" serial PRIMARY KEY NOT NULL,
  "team_id" integer NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "gender" "team_event_gender" NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_event_roster_players_team_idx"
  ON "team_event_roster_players" USING btree ("team_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_event_rubbers" (
  "id" serial PRIMARY KEY NOT NULL,
  "group_match_id" integer REFERENCES "matches"("id") ON DELETE CASCADE,
  "knockout_match_id" integer REFERENCES "knockout_matches"("id") ON DELETE CASCADE,
  "rubber_order" integer NOT NULL,
  "match_type" "team_event_match_type" NOT NULL,
  "target_points" integer NOT NULL,
  "best_of" integer NOT NULL,
  "disallow_same_male_from_previous_mixed" boolean DEFAULT false NOT NULL,
  "home_player_ids" integer[] DEFAULT '{}' NOT NULL,
  "away_player_ids" integer[] DEFAULT '{}' NOT NULL,
  "home_score" integer,
  "away_score" integer,
  "played" boolean DEFAULT false NOT NULL,
  "games" jsonb DEFAULT '[]'::jsonb NOT NULL,
  CONSTRAINT "team_event_rubbers_one_parent"
    CHECK (("group_match_id" IS NULL) <> ("knockout_match_id" IS NULL)),
  CONSTRAINT "team_event_rubbers_valid_order" CHECK ("rubber_order" >= 1),
  CONSTRAINT "team_event_rubbers_valid_target" CHECK ("target_points" IN (15, 21)),
  CONSTRAINT "team_event_rubbers_valid_best_of" CHECK ("best_of" IN (1, 3))
);
--> statement-breakpoint
ALTER TABLE "team_event_rubbers"
  ADD COLUMN IF NOT EXISTS "games" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_event_rubbers_group_order_unique"
  ON "team_event_rubbers" USING btree ("group_match_id", "rubber_order");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_event_rubbers_knockout_order_unique"
  ON "team_event_rubbers" USING btree ("knockout_match_id", "rubber_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_event_rubbers_group_match_idx"
  ON "team_event_rubbers" USING btree ("group_match_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_event_rubbers_knockout_match_idx"
  ON "team_event_rubbers" USING btree ("knockout_match_id");
--> statement-breakpoint
ALTER TABLE "team_event_configs"
  ADD COLUMN IF NOT EXISTS "dreambreaker_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_event_dreambreakers" (
  "id" serial PRIMARY KEY NOT NULL,
  "knockout_match_id" integer NOT NULL REFERENCES "knockout_matches"("id") ON DELETE CASCADE,
  "first_team_id" integer REFERENCES "teams"("id"),
  "home_player_ids" integer[] DEFAULT '{}' NOT NULL,
  "away_player_ids" integer[] DEFAULT '{}' NOT NULL,
  "home_score" integer,
  "away_score" integer,
  "played" boolean DEFAULT false NOT NULL,
  CONSTRAINT "team_event_dreambreakers_scores_nonnegative"
    CHECK (("home_score" IS NULL OR "home_score" >= 0) AND ("away_score" IS NULL OR "away_score" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_event_dreambreakers_knockout_unique"
  ON "team_event_dreambreakers" USING btree ("knockout_match_id");