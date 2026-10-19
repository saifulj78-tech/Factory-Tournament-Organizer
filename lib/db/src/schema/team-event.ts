import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { matchesTable, knockoutMatchesTable, teamsTable, tournamentTable } from "./tournament";

export const teamEventMatchTypeEnum = pgEnum("team_event_match_type", [
  "mens_singles",
  "womens_singles",
  "mens_doubles",
  "womens_doubles",
  "mixed_doubles",
]);

export const teamEventStageEnum = pgEnum("team_event_stage", ["group", "knockout"]);
export const teamEventGenderEnum = pgEnum("team_event_gender", ["male", "female"]);

/** One optional configuration row per team-event tournament. */
export const teamEventConfigsTable = pgTable("team_event_configs", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id")
    .notNull()
    .references(() => tournamentTable.id, { onDelete: "cascade" }),
  minMen: integer("min_men").notNull().default(3),
  minWomen: integer("min_women").notNull().default(1),
  dreambreakerEnabled: boolean("dreambreaker_enabled").notNull().default(false),
}, (table) => [
  uniqueIndex("team_event_configs_tournament_unique").on(table.tournamentId),
  check("team_event_configs_minimums_nonnegative", sql`${table.minMen} >= 0 AND ${table.minWomen} >= 0`),
]);

/** Ordered rubber definitions, independently configurable for group and knockout ties. */
export const teamEventRubberTemplatesTable = pgTable("team_event_rubber_templates", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id")
    .notNull()
    .references(() => tournamentTable.id, { onDelete: "cascade" }),
  stage: teamEventStageEnum("stage").notNull(),
  order: integer("rubber_order").notNull(),
  matchType: teamEventMatchTypeEnum("match_type").notNull(),
  targetPoints: integer("target_points").notNull().default(21),
  bestOf: integer("best_of").notNull().default(1),
  disallowSameMaleFromPreviousMixed: boolean("disallow_same_male_from_previous_mixed")
    .notNull()
    .default(false),
}, (table) => [
  uniqueIndex("team_event_templates_stage_order_unique").on(table.tournamentId, table.stage, table.order),
  index("team_event_templates_tournament_stage_idx").on(table.tournamentId, table.stage),
  check("team_event_templates_valid_order", sql`${table.order} >= 1`),
  check("team_event_templates_valid_target", sql`${table.targetPoints} IN (15, 21)`),
  check("team_event_templates_valid_best_of", sql`${table.bestOf} IN (1, 3)`),
]);

export const teamEventRosterPlayersTable = pgTable("team_event_roster_players", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id")
    .notNull()
    .references(() => teamsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  gender: teamEventGenderEnum("gender").notNull(),
}, (table) => [
  index("team_event_roster_players_team_idx").on(table.teamId),
]);

/**
 * A concrete rubber. Scores are aggregate game wins when bestOf is greater
 * than one, and point scores when bestOf is one; individual games are not stored.
 */
export const teamEventRubbersTable = pgTable("team_event_rubbers", {
  id: serial("id").primaryKey(),
  groupMatchId: integer("group_match_id")
    .references(() => matchesTable.id, { onDelete: "cascade" }),
  knockoutMatchId: integer("knockout_match_id")
    .references(() => knockoutMatchesTable.id, { onDelete: "cascade" }),
  order: integer("rubber_order").notNull(),
  matchType: teamEventMatchTypeEnum("match_type").notNull(),
  targetPoints: integer("target_points").notNull(),
  bestOf: integer("best_of").notNull(),
  disallowSameMaleFromPreviousMixed: boolean("disallow_same_male_from_previous_mixed")
    .notNull()
    .default(false),
  homePlayerIds: integer("home_player_ids").array().notNull().default([]),
  awayPlayerIds: integer("away_player_ids").array().notNull().default([]),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  /** Ordered individual rally-game scores; aggregate columns retain compatibility. */
  games: jsonb("games").$type<Array<{ homeScore: number; awayScore: number }>>().notNull().default([]),
  played: boolean("played").notNull().default(false),
}, (table) => [
  uniqueIndex("team_event_rubbers_group_order_unique").on(table.groupMatchId, table.order),
  uniqueIndex("team_event_rubbers_knockout_order_unique").on(table.knockoutMatchId, table.order),
  index("team_event_rubbers_group_match_idx").on(table.groupMatchId),
  index("team_event_rubbers_knockout_match_idx").on(table.knockoutMatchId),
  check("team_event_rubbers_one_parent", sql`(${table.groupMatchId} IS NULL) <> (${table.knockoutMatchId} IS NULL)`),
  check("team_event_rubbers_valid_order", sql`${table.order} >= 1`),
  check("team_event_rubbers_valid_target", sql`${table.targetPoints} IN (15, 21)`),
  check("team_event_rubbers_valid_best_of", sql`${table.bestOf} IN (1, 3)`),
]);

/** Conditional singles rotation used to decide a tied knockout tie. */
export const teamEventDreambreakersTable = pgTable("team_event_dreambreakers", {
  id: serial("id").primaryKey(),
  knockoutMatchId: integer("knockout_match_id").notNull()
    .references(() => knockoutMatchesTable.id, { onDelete: "cascade" }),
  firstTeamId: integer("first_team_id").references(() => teamsTable.id),
  homePlayerIds: integer("home_player_ids").array().notNull().default([]),
  awayPlayerIds: integer("away_player_ids").array().notNull().default([]),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  played: boolean("played").notNull().default(false),
}, (table) => [
  uniqueIndex("team_event_dreambreakers_knockout_unique").on(table.knockoutMatchId),
  check("team_event_dreambreakers_scores_nonnegative", sql`(${table.homeScore} IS NULL OR ${table.homeScore} >= 0) AND (${table.awayScore} IS NULL OR ${table.awayScore} >= 0)`),
]);

export const insertTeamEventConfigSchema = createInsertSchema(teamEventConfigsTable).omit({ id: true });
export const insertTeamEventRubberTemplateSchema = createInsertSchema(teamEventRubberTemplatesTable).omit({ id: true });
export const insertTeamEventRosterPlayerSchema = createInsertSchema(teamEventRosterPlayersTable).omit({ id: true });
export const insertTeamEventRubberSchema = createInsertSchema(teamEventRubbersTable).omit({ id: true });
export const insertTeamEventDreambreakerSchema = createInsertSchema(teamEventDreambreakersTable).omit({ id: true });

export type TeamEventConfig = typeof teamEventConfigsTable.$inferSelect;
export type InsertTeamEventConfig = z.infer<typeof insertTeamEventConfigSchema>;
export type TeamEventRubberTemplate = typeof teamEventRubberTemplatesTable.$inferSelect;
export type InsertTeamEventRubberTemplate = z.infer<typeof insertTeamEventRubberTemplateSchema>;
export type TeamEventRosterPlayer = typeof teamEventRosterPlayersTable.$inferSelect;
export type InsertTeamEventRosterPlayer = z.infer<typeof insertTeamEventRosterPlayerSchema>;
export type TeamEventRubber = typeof teamEventRubbersTable.$inferSelect;
export type InsertTeamEventRubber = z.infer<typeof insertTeamEventRubberSchema>;
export type TeamEventDreambreaker = typeof teamEventDreambreakersTable.$inferSelect;
export type InsertTeamEventDreambreaker = z.infer<typeof insertTeamEventDreambreakerSchema>;