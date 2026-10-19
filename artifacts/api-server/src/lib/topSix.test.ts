import { describe, expect, it } from "vitest";
import { topSixSlots } from "./topSix";
import { computeBreakoutBracket, type StoredBreakoutScore } from "./breakoutBracket";

describe("Top 6 Playoff", () => {
  it("gives only seeds 1 and 2 semifinal byes, with the requested quarterfinal pairings", () => {
    const ranked = [101, 102, 103, 104, 105, 106];
    expect(topSixSlots(ranked)).toEqual([101, null, 104, 105, 102, null, 103, 106]);
    const state = computeBreakoutBracket(ranked, {});
    expect(state.matches.filter((match) => match.round === 1 && match.bye).map((match) => match.winnerId)).toEqual([101, 102]);
    expect(state.matches.filter((match) => match.round === 1 && !match.bye).map((match) => [match.homeTeamId, match.awayTeamId]))
      .toEqual([[104, 105], [103, 106]]);
    expect(state.matches.filter((match) => match.round === 2).map((match) => [match.homeTeamId, match.awayTeamId]))
      .toEqual([[101, null], [102, null]]);
    expect(state.winnerTeamId).toBeNull();
  });

  it("feeds each quarterfinal into the correct semifinal and produces one champion after five games", () => {
    const seeds = [1, 2, 3, 4, 5, 6];
    const scores: Record<string, StoredBreakoutScore> = {};
    const qfs = computeBreakoutBracket(seeds, {}).matches.filter((match) => match.round === 1 && !match.bye);
    for (const match of qfs) scores[String(match.id)] = {
      homeTeamId: match.homeTeamId!, awayTeamId: match.awayTeamId!, homeScore: 21, awayScore: 11,
    };
    const semifinal = computeBreakoutBracket(seeds, scores);
    expect(semifinal.matches.filter((match) => match.round === 2).map((match) => [match.homeTeamId, match.awayTeamId]))
      .toEqual([[1, 4], [2, 3]]);
    for (let i = 0; i < 3; i++) {
      const match = computeBreakoutBracket(seeds, scores).matches.find((row) => row.ready && !row.bye && !row.played)!;
      scores[String(match.id)] = { homeTeamId: match.homeTeamId!, awayTeamId: match.awayTeamId!, homeScore: 21, awayScore: 11 };
    }
    const completed = computeBreakoutBracket(seeds, scores);
    expect(completed.winnerTeamId).toBe(1);
    expect(completed.matches.filter((match) => match.played)).toHaveLength(5);
  });

  it.each([[], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 5]].map((seeds) => ({ seeds })))("rejects anything but six distinct seeds: $seeds", ({ seeds }) => {
    expect(() => topSixSlots(seeds)).toThrow("exactly six distinct");
  });
});
