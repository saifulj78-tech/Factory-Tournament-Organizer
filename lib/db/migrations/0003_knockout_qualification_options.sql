ALTER TABLE "tournament"
  ADD COLUMN IF NOT EXISTS "wildcard_qualifiers" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "third_place_playoff_enabled" boolean NOT NULL DEFAULT true;