import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tournamentTable } from "./tournament";

/** Individual players registered for an Individual Ladder tournament. */
export const ladderParticipantsTable = pgTable(
  "ladder_participants",
  {
    id: serial("id").primaryKey(),
    tournamentId: integer("tournament_id").notNull().references(() => tournamentTable.id, { onDelete: "cascade" }),
    seed: integer("seed"),
    name: text("name").notNull(),
    isHere: boolean("is_here").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ladder_participants_tournament_idx").on(table.tournamentId),
    uniqueIndex("ladder_participants_tournament_seed_idx").on(table.tournamentId, table.seed),
  ],
);

/**
 * Each court keeps an ordered waiting list. The active four players are stored
 * on the current ladder game, which makes game history immutable.
 */
export const ladderCourtsTable = pgTable(
  "ladder_courts",
  {
    id: serial("id").primaryKey(),
    tournamentId: integer("tournament_id").notNull().references(() => tournamentTable.id, { onDelete: "cascade" }),
    courtNumber: integer("court_number").notNull(),
    queuePlayerIds: integer("queue_player_ids").array().notNull().default([]),
  },
  (table) => [uniqueIndex("ladder_courts_tournament_court_idx").on(table.tournamentId, table.courtNumber)],
);

export const ladderGamesTable = pgTable(
  "ladder_games",
  {
    id: serial("id").primaryKey(),
    tournamentId: integer("tournament_id").notNull().references(() => tournamentTable.id, { onDelete: "cascade" }),
    batchNumber: integer("batch_number").notNull(),
    courtNumber: integer("court_number").notNull(),
    homePlayerOneId: integer("home_player_one_id").notNull().references(() => ladderParticipantsTable.id),
    homePlayerTwoId: integer("home_player_two_id").notNull().references(() => ladderParticipantsTable.id),
    awayPlayerOneId: integer("away_player_one_id").notNull().references(() => ladderParticipantsTable.id),
    awayPlayerTwoId: integer("away_player_two_id").notNull().references(() => ladderParticipantsTable.id),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    played: boolean("played").notNull().default(false),
    winnerMovement: text("winner_movement"),
    loserMovement: text("loser_movement"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ladder_games_tournament_batch_court_idx").on(table.tournamentId, table.batchNumber, table.courtNumber),
    index("ladder_games_tournament_batch_idx").on(table.tournamentId, table.batchNumber),
  ],
);

export const insertLadderParticipantSchema = createInsertSchema(ladderParticipantsTable)
  .omit({ id: true, createdAt: true });
export const insertLadderCourtSchema = createInsertSchema(ladderCourtsTable).omit({ id: true });
export const insertLadderGameSchema = createInsertSchema(ladderGamesTable)
  .omit({ id: true, completedAt: true });

export type LadderParticipant = typeof ladderParticipantsTable.$inferSelect;
export type LadderCourt = typeof ladderCourtsTable.$inferSelect;
export type LadderGame = typeof ladderGamesTable.$inferSelect;
export type InsertLadderParticipant = z.infer<typeof insertLadderParticipantSchema>;
export type InsertLadderCourt = z.infer<typeof insertLadderCourtSchema>;
export type InsertLadderGame = z.infer<typeof insertLadderGameSchema>;