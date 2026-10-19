import { pgEnum, pgTable, text, serial, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const wildcardRankingMethodEnum = pgEnum("wildcard_ranking_method", ["points", "ppg"]);
export const wildcardSelectionMethodEnum = pgEnum("wildcard_selection_method", ["ranking", "round_robin"]);

export const tournamentTable = pgTable("tournament", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("My Tournament"),
  groupCount: integer("group_count").notNull().default(4),
  teamsPerGroup: integer("teams_per_group").notNull().default(4),
  courtCount: integer("court_count").notNull().default(2),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: text("created_by"),
  format: text("format").notNull().default("round_robin"),
  qualifiersPerGroup: integer("qualifiers_per_group"),
  wildcardQualifiers: integer("wildcard_qualifiers").notNull().default(0),
  knockoutFormat: text("knockout_format").notNull().default("single"), // 'single' | 'double' | 'top6'
  thirdPlacePlayoffEnabled: boolean("third_place_playoff_enabled").notNull().default(true),
  tiebreakerOrder: text("tiebreaker_order").notNull().default("goal_difference,goals_for,goals_against,head_to_head"),
  wildcardRankingMethod: wildcardRankingMethodEnum("wildcard_ranking_method").notNull().default("points"),
  wildcardSelectionMethod: wildcardSelectionMethodEnum("wildcard_selection_method").notNull().default("ranking"),
});

export const groupsTable = pgTable("groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  groupNumber: integer("group_number").notNull(),
  tournamentId: integer("tournament_id").notNull().references(() => tournamentTable.id, { onDelete: "cascade" }),
});

export const teamsTable = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  groupId: integer("group_id").notNull(),
});

export const matchesTable = pgTable("matches", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  homeTeamId: integer("home_team_id").notNull(),
  awayTeamId: integer("away_team_id").notNull(),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  played: boolean("played").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }),
  roundNumber: integer("round_number").notNull().default(1),
  courtNumber: integer("court_number"),
});

export const knockoutMatchesTable = pgTable("knockout_matches", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull().references(() => tournamentTable.id, { onDelete: "cascade" }),
  round: text("round").notNull(), // single-elim: 'r32'|'r16'|'quarter'|'semi'|'final'; double-elim WB: 'w1'|'w2'|…; LB: 'l1'|'l2'|…; GF: 'grand_final'
  matchNumber: integer("match_number").notNull(), // 1-indexed within the round
  homeTeamId: integer("home_team_id"),
  awayTeamId: integer("away_team_id"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  played: boolean("played").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }),
  winnerId: integer("winner_id"),
  // Double-elimination fields (null for single-elim matches)
  bracket: text("bracket"),            // 'winner' | 'loser' | 'grand_final' | null
  loserDropsToMatchId: integer("loser_drops_to_match_id"), // WB only: which LB match the loser goes to
  loserDropsToSlot: text("loser_drops_to_slot"),           // 'home' | 'away'
});

export const wildcardPlayoffMatchesTable = pgTable("wildcard_playoff_matches", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull().references(() => tournamentTable.id, { onDelete: "cascade" }),
  gameNumber: integer("game_number").notNull(),
  homeTeamId: integer("home_team_id").notNull(),
  awayTeamId: integer("away_team_id").notNull(),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  played: boolean("played").notNull().default(false),
}, (table) => [
  uniqueIndex("wildcard_playoff_matches_tournament_game_unique").on(table.tournamentId, table.gameNumber),
]);

export const tournamentCoOrganizersTable = pgTable("tournament_co_organizers", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull().references(() => tournamentTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  addedAt: timestamp("added_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tournament_co_organizers_tournament_user_unique")
    .on(table.tournamentId, table.userId),
]);

export const organizersTable = pgTable("organizers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  clerkUserId: text("clerk_user_id"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTournamentSchema = createInsertSchema(tournamentTable).omit({ id: true });
export const insertGroupSchema = createInsertSchema(groupsTable).omit({ id: true });
export const insertTeamSchema = createInsertSchema(teamsTable).omit({ id: true });
export const insertMatchSchema = createInsertSchema(matchesTable).omit({ id: true });

export type Tournament = typeof tournamentTable.$inferSelect;
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Group = typeof groupsTable.$inferSelect;
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type Team = typeof teamsTable.$inferSelect;
export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Match = typeof matchesTable.$inferSelect;
