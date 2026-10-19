import { describe, expect, it } from "vitest";
import {
  calculateWildcardPlayoffStandings,
  selectThirdPlaceCandidates,
} from "./wildcard-playoff-ranking.js";

describe("wildcard playoff ranking", () => {
  it("sorts by wins, points, goal difference, and goals for", () => {
    const result = calculateWildcardPlayoffStandings([
      { homeTeamId: 3, awayTeamId: 6, homeScore: 2, awayScore: 0, played: true },
      { homeTeamId: 6, awayTeamId: 9, homeScore: 0, awayScore: 3, played: true },
      { homeTeamId: 9, awayTeamId: 3, homeScore: 2, awayScore: 1, played: true },
    ], [
      { id: 3, name: "Group A third" },
      { id: 6, name: "Group B third" },
      { id: 9, name: "Group C third" },
    ]);

    expect(result.standings.map(({ teamId }) => teamId)).toEqual([9, 3, 6]);
    expect(result.standings.map(({ points }) => points)).toEqual([6, 3, 0]);
    expect(result.qualifiedTeamIds).toEqual([9, 3]);
    expect(result.tieAtCutoff).toBe(false);
  });

  it("does not qualify teams until every playoff match has been scored", () => {
    const result = calculateWildcardPlayoffStandings([
      { homeTeamId: 3, awayTeamId: 6, homeScore: 2, awayScore: 0, played: true },
      { homeTeamId: 6, awayTeamId: 9, homeScore: 1, awayScore: 0, played: true },
      { homeTeamId: 9, awayTeamId: 3, homeScore: null, awayScore: null, played: false },
    ], [
      { id: 3, name: "A" },
      { id: 6, name: "B" },
      { id: 9, name: "C" },
    ]);

    expect(result.qualifiedTeamIds).toBeNull();
    expect(result.tieAtCutoff).toBe(false);
  });

  it("selects exactly the current third-place candidate from each group", () => {
    const groups = [{ id: 10 }, { id: 11 }, { id: 12 }];
    const teams = [
      { id: 1, name: "A1", groupId: 10 }, { id: 2, name: "A2", groupId: 10 }, { id: 3, name: "A3", groupId: 10 },
      { id: 4, name: "B1", groupId: 11 }, { id: 5, name: "B2", groupId: 11 }, { id: 6, name: "B3", groupId: 11 },
      { id: 7, name: "C1", groupId: 12 }, { id: 8, name: "C2", groupId: 12 }, { id: 9, name: "C3", groupId: 12 },
    ];
    const matches = [10, 11, 12].flatMap((groupId, i) => {
      const first = i * 3 + 1;
      return [
        { groupId, homeTeamId: first, awayTeamId: first + 1, homeScore: 2, awayScore: 0, played: true },
        { groupId, homeTeamId: first, awayTeamId: first + 2, homeScore: 2, awayScore: 0, played: true },
        { groupId, homeTeamId: first + 1, awayTeamId: first + 2, homeScore: 1, awayScore: 0, played: true },
      ];
    });
    const compare = (a: { pts: number; teamId: number }, b: { pts: number; teamId: number }) =>
      b.pts - a.pts || a.teamId - b.teamId;

    expect(selectThirdPlaceCandidates(groups, teams, matches, compare)).toEqual([
      { teamId: 3, teamName: "A3" },
      { teamId: 6, teamName: "B3" },
      { teamId: 9, teamName: "C3" },
    ]);
  });

  it("requires a manual choice when exact statistics are tied at the cutoff", () => {
    const result = calculateWildcardPlayoffStandings([
      { homeTeamId: 3, awayTeamId: 6, homeScore: 1, awayScore: 0, played: true },
      { homeTeamId: 6, awayTeamId: 9, homeScore: 1, awayScore: 0, played: true },
      { homeTeamId: 9, awayTeamId: 3, homeScore: 1, awayScore: 0, played: true },
    ], [
      { id: 3, name: "A" },
      { id: 6, name: "B" },
      { id: 9, name: "C" },
    ]);

    expect(result.standings.map(({ teamId }) => teamId)).toEqual([3, 6, 9]);
    expect(result.tieAtCutoff).toBe(true);
    expect(result.qualifiedTeamIds).toBeNull();
  });
});