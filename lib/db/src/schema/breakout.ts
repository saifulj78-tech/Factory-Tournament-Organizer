import { pgTable, serial, integer, text, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { tournamentTable } from "./tournament";

export type BreakoutScore = {
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
};

export const breakoutKnockoutsTable = pgTable("breakout_knockouts", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull().references(() => tournamentTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  name: text("name").notNull(),
  groupIds: jsonb("group_ids").$type<number[]>().notNull().default([]),
  seeds: jsonb("seeds").$type<number[]>().notNull().default([]),
  scores: jsonb("scores").$type<Record<string, BreakoutScore>>().notNull().default({}),
}, (table) => [
  uniqueIndex("breakout_knockouts_tournament_position_unique").on(table.tournamentId, table.position),
]);
