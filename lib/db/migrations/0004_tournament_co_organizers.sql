CREATE TABLE IF NOT EXISTS "tournament_co_organizers" (
  "id" serial PRIMARY KEY NOT NULL,
  "tournament_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "email" text NOT NULL,
  "added_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tournament_co_organizers_tournament_id_tournament_id_fk"
    FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id")
    ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS "tournament_co_organizers_tournament_user_unique"
  ON "tournament_co_organizers" ("tournament_id", "user_id");