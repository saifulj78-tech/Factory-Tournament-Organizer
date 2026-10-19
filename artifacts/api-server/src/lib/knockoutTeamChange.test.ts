import { describe, expect, it } from "vitest";
import { reconcileSingleEliminationTeamChange } from "./knockoutTeamChange";

type Match = Parameters<typeof reconcileSingleEliminationTeamChange>[0][number];

function match(id: number, round: string, matchNumber: number, homeTeamId: number | null, awayTeamId: number | null, extras: Partial<Match> = {}): Match {
  return {
    id, tournamentId: 1, round, matchNumber, homeTeamId, awayTeamId,
    homeScore: null, awayScore: null, winnerId: null, played: false,
    startedAt: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null,
    ...extras,
  };
}

describe("single-elimination team removal", () => {
  it("removes the deleted team's old result, preserves unrelated results, and awards justified byes", () => {
    const rows = [
      match(1, "semi", 1, 1, 2, { played: true, homeScore: 2, awayScore: 1, winnerId: 1 }),
      match(2, "semi", 2, 3, 4, { played: true, homeScore: 2, awayScore: 0, winnerId: 3 }),
      match(3, "final", 1, 1, 3, { played: true, homeScore: 2, awayScore: 1, winnerId: 1 }),
      match(4, "third_place", 1, 2, 4, { played: true, homeScore: 2, awayScore: 0, winnerId: 2 }),
    ];
    const result = reconcileSingleEliminationTeamChange(rows, 1, null);
    expect(result.matches.get(1)).toMatchObject({ homeTeamId: null, awayTeamId: 2, winnerId: 2, played: true, homeScore: null });
    expect(result.matches.get(2)).toMatchObject({ winnerId: 3, played: true, homeScore: 2 });
    expect(result.matches.get(3)).toMatchObject({ homeTeamId: 2, awayTeamId: 3, winnerId: null, played: false, homeScore: null });
    expect(result.matches.get(4)).toMatchObject({ homeTeamId: null, awayTeamId: 4, winnerId: 4, played: true, homeScore: null });
    expect(result.scoresCleared).toBe(3);
  });

  it("does not award a bye through a round whose other source has not finished", () => {
    const rows = [
      match(1, "quarter", 1, 1, 2),
      match(2, "quarter", 2, 3, 4),
      match(3, "semi", 1, null, null),
    ];
    const result = reconcileSingleEliminationTeamChange(rows, 1, null);
    expect(result.matches.get(1)).toMatchObject({ homeTeamId: null, awayTeamId: 2, winnerId: 2, played: true });
    expect(result.matches.get(3)).toMatchObject({ homeTeamId: 2, awayTeamId: null, winnerId: null, played: false });
  });

  it("marks an emptied source final so the opposing path can advance", () => {
    const rows = [
      match(1, "semi", 1, 1, null, { played: true, winnerId: 1 }),
      match(2, "semi", 2, 3, 4, { played: true, homeScore: 2, awayScore: 0, winnerId: 3 }),
      match(3, "final", 1, 1, 3),
    ];
    const result = reconcileSingleEliminationTeamChange(rows, 1, null);
    expect(result.matches.get(1)).toMatchObject({ homeTeamId: null, awayTeamId: null, winnerId: null, played: true });
    expect(result.matches.get(3)).toMatchObject({ homeTeamId: null, awayTeamId: 3, winnerId: 3, played: true });
  });
});