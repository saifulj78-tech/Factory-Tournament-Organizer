import { describe, expect, it } from "vitest";
import { compareWildcardCandidates, type WildcardCandidate } from "./wildcard-ranking.js";

const tiebreakers = ["goal_difference", "goals_for", "goals_against", "head_to_head"] as const;

function candidate(overrides: Partial<WildcardCandidate>): WildcardCandidate {
  return {
    teamId: 1,
    groupIndex: 0,
    position: 1,
    pts: 0,
    gf: 0,
    ga: 0,
    played: 0,
    ...overrides,
  };
}

describe("wildcard ranking", () => {
  it("uses exact PPG for second-place candidates in 8-team and 7-team groups", () => {
    // Both teams have 9 points, but the 7-team group candidate played 6 matches
    // versus 7 in the larger group: 9/6 is better than 9/7.
    const eightTeamGroup = candidate({ teamId: 18, groupIndex: 0, pts: 9, played: 7, gf: 30, ga: 4 });
    const sevenTeamGroup = candidate({ teamId: 27, groupIndex: 1, pts: 9, played: 6, gf: 8, ga: 7 });

    expect(compareWildcardCandidates(eightTeamGroup, sevenTeamGroup, "ppg", tiebreakers)).toBeGreaterThan(0);
    // Legacy default remains points first, then raw configured tiebreak totals.
    expect(compareWildcardCandidates(eightTeamGroup, sevenTeamGroup, "points", tiebreakers)).toBeLessThan(0);
  });

  it("uses normalized configured tiebreakers for equal PPG, not raw points totals", () => {
    const fewerMatches = candidate({ teamId: 10, groupIndex: 0, pts: 6, played: 4, gf: 8, ga: 4 });
    const moreMatches = candidate({ teamId: 20, groupIndex: 1, pts: 9, played: 6, gf: 18, ga: 12 });

    // Both have 1.5 PPG and +1 GD/game. Goals-for/game is the next configured
    // tiebreaker; 3/game wins over 2/game despite lower raw points being absent.
    expect(compareWildcardCandidates(fewerMatches, moreMatches, "ppg", tiebreakers)).toBeGreaterThan(0);
  });

  it("treats zero-played candidates as 0 PPG and resolves exact ties deterministically", () => {
    const noGamesEarlierGroup = candidate({ teamId: 30, groupIndex: 0 });
    const noGamesLaterGroup = candidate({ teamId: 20, groupIndex: 1 });
    const playedNoPoints = candidate({ teamId: 10, groupIndex: 2, played: 3 });

    expect(compareWildcardCandidates(noGamesEarlierGroup, noGamesLaterGroup, "ppg", tiebreakers)).toBeLessThan(0);
    expect(compareWildcardCandidates(noGamesLaterGroup, playedNoPoints, "ppg", tiebreakers)).toBeLessThan(0);
  });

  it("keeps finishing-position priority ahead of wildcard statistics", () => {
    const lowerFinish = candidate({ position: 2, pts: 30, played: 4 });
    const higherFinish = candidate({ position: 1, pts: 0, played: 0 });

    expect(compareWildcardCandidates(higherFinish, lowerFinish, "ppg", tiebreakers)).toBeLessThan(0);
  });
});