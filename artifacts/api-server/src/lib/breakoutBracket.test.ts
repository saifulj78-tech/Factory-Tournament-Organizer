import { describe, expect, it } from "vitest";
import { computeBreakoutBracket, validBreakoutGroups, type StoredBreakoutScore } from "./breakoutBracket";

function finish(seeds: number[]) {
  const scores: Record<string, StoredBreakoutScore> = {};
  for (let round = 0; round < 7; round++) {
    for (const match of computeBreakoutBracket(seeds, scores).matches) {
      if (match.ready && !match.bye && !match.played && match.homeTeamId && match.awayTeamId) {
        scores[String(match.id)] = { homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId, homeScore: 21, awayScore: 12 };
      }
    }
  }
  return { scores, state: computeBreakoutBracket(seeds, scores) };
}

describe("independent breakout draws", () => {
  it.each([2, 3, 4, 5, 6, 7, 9, 32, 64])("advances a %i-team draw through byes to exactly one winner", (count) => {
    const seeds = Array.from({ length: count }, (_, i) => i + 1);
    const { state } = finish(seeds);
    expect(state.winnerTeamId).toBe(1);
    expect(state.matches.filter((match) => match.played)).toHaveLength(count - 1);
    const initial = state.matches.filter((match) => match.round === 1);
    const participants = initial.flatMap((match) => [match.homeTeamId, match.awayTeamId]).filter((id) => id !== null);
    expect(new Set(participants).size).toBe(count);
  });

  it("does not invent an early winner or make a waiting semifinal a bye", () => {
    const result = computeBreakoutBracket([1, 2, 3, 4, 5], {});
    expect(result.winnerTeamId).toBeNull();
    expect(result.matches.at(-1)?.ready).toBe(false);
    expect(result.matches.at(-1)?.bye).toBe(false);
  });

  it("clears only stale descendants when an earlier winner changes", () => {
    const { scores, state } = finish([1, 2, 3, 4]);
    const first = state.matches[0];
    scores[String(first.id)] = { homeTeamId: first.homeTeamId!, awayTeamId: first.awayTeamId!, homeScore: 1, awayScore: 21 };
    const changed = computeBreakoutBracket([1, 2, 3, 4], scores);
    expect(changed.matches[1].played).toBe(true);
    expect(changed.matches[2].played).toBe(false);
    expect(changed.validScores["3"]).toBeUndefined();
    expect(changed.winnerTeamId).toBeNull();
  });

  it("keeps the next-round result when a correction leaves the same winner", () => {
    const { scores } = finish([1, 2, 3, 4]);
    scores["1"].homeScore = 22;
    expect(computeBreakoutBracket([1, 2, 3, 4], scores).winnerTeamId).toBe(1);
  });

  it("requires two disjoint sets of real tournament groups", () => {
    const allowed = new Set([1, 2, 3, 4]);
    expect(validBreakoutGroups([{ groupIds: [1, 2] }, { groupIds: [3, 4] }], allowed)).toBe(true);
    for (const brackets of [
      [{ groupIds: [1] }],
      [{ groupIds: [] }, { groupIds: [2] }],
      [{ groupIds: [1, 1] }, { groupIds: [2] }],
      [{ groupIds: [1] }, { groupIds: [1, 2] }],
      [{ groupIds: [1] }, { groupIds: [99] }],
    ]) expect(validBreakoutGroups(brackets, allowed)).toBe(false);
  });
});
