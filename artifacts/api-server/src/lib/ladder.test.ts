import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  ladderCourtsTable: {},
  ladderGamesTable: {},
  ladderParticipantsTable: {},
}));

import {
  buildLadderStandings,
  buildAmericanoRound,
  buildAmericanoRoundAvoidingPartners,
  buildNextLadderRound,
  loserMovement,
  movementPool,
  pointsForCourt,
  serializeLadderState,
  splitAcrossCourts,
  takeNextGame,
  winnerMovement,
} from "./ladder.js";

type Participant = Parameters<typeof buildLadderStandings>[0][number];
type Game = Parameters<typeof buildLadderStandings>[1][number];
type Court = Parameters<typeof serializeLadderState>[3][number];

function participants(count: number, legacy = false): Participant[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    tournamentId: 1,
    seed: legacy ? null : index + 1,
    name: `Player ${index + 1}`,
    isHere: true,
    createdAt: new Date(),
  })) as Participant[];
}

function game(
  courtNumber: number,
  home: [number, number],
  away: [number, number],
  homeScore: number,
  awayScore: number,
): Game {
  return {
    id: courtNumber,
    tournamentId: 1,
    batchNumber: 1,
    courtNumber,
    homePlayerOneId: home[0],
    homePlayerTwoId: home[1],
    awayPlayerOneId: away[0],
    awayPlayerTwoId: away[1],
    homeScore,
    awayScore,
    played: true,
    winnerMovement: null,
    loserMovement: null,
    createdAt: new Date(),
    completedAt: new Date(),
  } as Game;
}

describe("Individual Ladder standings", () => {
  it("awards 6 and 4 points on a two-court ladder and resolves equal points by seed", () => {
    const standings = buildLadderStandings(participants(8), [
      game(1, [1, 2], [3, 4], 11, 5),
      game(2, [5, 6], [7, 8], 4, 9),
    ]);

    expect(standings.map(({ rank, player, points }) => [rank, player.seed, points])).toEqual([
      [1, 1, 6], [2, 2, 6], [3, 7, 4], [4, 8, 4],
      [5, 3, 0], [6, 4, 0], [7, 5, 0], [8, 6, 0],
    ]);
    expect(standings.find((standing) => standing.player.seed === 1)).toMatchObject({ wins: 1, losses: 0, gamesPlayed: 1 });
    expect(standings.find((standing) => standing.player.seed === 3)).toMatchObject({ wins: 0, losses: 1, gamesPlayed: 1 });
  });

  it("awards 6, 4, and 2 points on a three-court ladder", () => {
    const standings = buildLadderStandings(participants(12), [
      game(1, [1, 2], [3, 4], 11, 5),
      game(2, [5, 6], [7, 8], 4, 9),
      game(3, [9, 10], [11, 12], 10, 7),
    ]);

    expect(pointsForCourt(1)).toBe(6);
    expect(pointsForCourt(2)).toBe(4);
    expect(pointsForCourt(3)).toBe(2);
    expect(standings.map(({ player, points }) => [player.seed, points])).toEqual([
      [1, 6], [2, 6], [7, 4], [8, 4], [9, 2], [10, 2],
      [3, 0], [4, 0], [5, 0], [6, 0], [11, 0], [12, 0],
    ]);
  });

  it("tracks each player's active winning streak", () => {
    const first = game(1, [1, 2], [3, 4], 11, 5);
    const second = { ...game(1, [1, 3], [2, 4], 11, 7), id: 2, batchNumber: 2 };
    const third = { ...game(1, [1, 4], [2, 3], 11, 8), id: 3, batchNumber: 3 };
    const standings = buildLadderStandings(participants(4), [third, first, second]);

    expect(standings.find((standing) => standing.player.id === 1)?.currentWinStreak).toBe(3);
    expect(standings.find((standing) => standing.player.id === 2)?.currentWinStreak).toBe(0);
    expect(standings.find((standing) => standing.player.id === 4)?.currentWinStreak).toBe(1);
  });

  it("starts every seeded player at zero points in deterministic seed order", () => {
    const standings = buildLadderStandings(participants(6), []);

    expect(standings.map(({ rank, player, points, gamesPlayed }) => [rank, player.seed, points, gamesPlayed])).toEqual([
      [1, 1, 0, 0], [2, 2, 0, 0], [3, 3, 0, 0],
      [4, 4, 0, 0], [5, 5, 0, 0], [6, 6, 0, 0],
    ]);
  });

  it("gives legacy seedless participants a deterministic seed order until their next start", () => {
    const standings = buildLadderStandings(participants(4, true), []);

    expect(standings.map(({ rank, player }) => [rank, player.seed])).toEqual([
      [1, 1], [2, 2], [3, 3], [4, 4],
    ]);
  });

  it("uses the same legacy fallback seeds in participants, games, queues, and standings", () => {
    const state = serializeLadderState(
      1,
      1,
      participants(5, true),
      [{
        id: 1,
        tournamentId: 1,
        courtNumber: 1,
        queuePlayerIds: [5],
      }] as Court[],
      [game(1, [1, 2], [3, 4], 11, 5)],
    );

    expect(state.participants.map((player) => player.seed)).toEqual([1, 2, 3, 4, 5]);
    expect(state.courts[0].activeGame?.homeTeam.players.map((player) => player.seed)).toEqual([1, 2]);
    expect(state.courts[0].waitingPlayers.map((player) => player.seed)).toEqual([5]);
    expect(state.standings.map((standing) => [standing.rank, standing.player.seed])).toEqual([
      [1, 1], [2, 2], [3, 3], [4, 4], [5, 5],
    ]);
  });
});

describe("Individual Ladder movement", () => {
  it("rotates Americano partners without repeating the opening pairs", () => {
    expect(buildAmericanoRound([1, 2, 3, 4, 5, 6, 7, 8], 0)).toEqual([
      [1, 8, 2, 7],
      [3, 6, 4, 5],
    ]);
    expect(buildAmericanoRound([1, 2, 3, 4, 5, 6, 7, 8], 1)).toEqual([
      [1, 7, 8, 6],
      [2, 5, 3, 4],
    ]);
  });

  it("finds a new one-court partnership after a manual opening round", () => {
    const used = new Set(["1:2", "3:4"]);
    const next = buildAmericanoRoundAvoidingPartners([1, 2, 3, 4], used, 1);
    expect(next).toHaveLength(1);
    expect(next[0]).toHaveLength(4);
    expect(used.has([...next[0].slice(0, 2)].sort((a, b) => a - b).join(":"))).toBe(false);
    expect(used.has([...next[0].slice(2, 4)].sort((a, b) => a - b).join(":"))).toBe(false);
  });

  it("counts every Americano point for both partners", () => {
    const standings = buildLadderStandings(
      participants(4),
      [game(1, [1, 4], [2, 3], 21, 11)],
      "americano",
    );

    expect(standings.map(({ player, points }) => [player.id, points])).toEqual([
      [1, 21], [4, 21], [2, 11], [3, 11],
    ]);
  });

  it("starts 20 seeded players in three courts and two four-player benches", () => {
    expect(splitAcrossCourts(Array.from({ length: 20 }, (_, index) => index + 1), 3)).toEqual([
      [1, 2, 3, 4, 9, 10, 11, 12],
      [5, 6, 7, 8],
      [13, 14, 15, 16, 17, 18, 19, 20],
    ]);
  });

  it("balances the seeded opening matchup as 1+4 versus 2+3", () => {
    expect(takeNextGame([1, 2, 3, 4], true)).toEqual({
      homePlayerOneId: 1,
      homePlayerTwoId: 4,
      awayPlayerOneId: 2,
      awayPlayerTwoId: 3,
      queuePlayerIds: [],
    });
  });

  it("moves a 20-player three-court ladder through its five zones", () => {
    const games = new Map([
      [1, game(1, [1, 2], [3, 4], 11, 5)],
      [2, game(2, [9, 10], [11, 12], 11, 5)],
      [3, game(3, [13, 14], [15, 16], 11, 5)],
    ]);
    const queues = new Map<number, number[]>([
      [1, [5, 6, 7, 8]],
      [2, []],
      [3, [17, 18, 19, 20]],
    ]);
    const nextRound = buildNextLadderRound(3, queues, games);

    expect(winnerMovement(2, 3)).toBe("up");
    expect(loserMovement(3, 3)).toBe("down");
    expect(nextRound.get(1)).toEqual({
      gamePlayerIds: [1, 2, 9, 10],
      queuePlayerIds: [7, 8, 3, 4],
    });
    expect(nextRound.get(2)).toEqual({
      gamePlayerIds: [13, 5, 14, 6],
      queuePlayerIds: [],
    });
    expect(nextRound.get(3)).toEqual({
      gamePlayerIds: [17, 18, 19, 20],
      queuePlayerIds: [11, 12, 15, 16],
    });
    expect(takeNextGame(nextRound.get(1)!.gamePlayerIds)).toMatchObject({
      homePlayerOneId: 1,
      awayPlayerOneId: 2,
    });
  });

  it("keeps Court 3 rotating when one player is late", () => {
    const games = new Map([
      [1, game(1, [1, 2], [3, 4], 11, 5)],
      [2, game(2, [5, 6], [7, 8], 11, 5)],
      [3, game(3, [9, 10], [11, 12], 11, 5)],
    ]);
    const nextRound = buildNextLadderRound(3, new Map([
      [1, [13, 14, 15, 16]],
      [2, []],
      [3, [17, 18, 19]],
    ]), games);

    expect(nextRound.get(3)).toEqual({
      gamePlayerIds: [17, 18, 19, 11],
      queuePlayerIds: [7, 8, 12],
    });
  });

  it("keeps an already-started legacy ladder moving when it has no full benches", () => {
    const games = new Map([
      [1, game(1, [1, 2], [3, 4], 11, 5)],
      [2, game(2, [5, 6], [7, 8], 11, 5)],
      [3, game(3, [9, 10], [11, 12], 11, 5)],
    ]);
    const nextRound = buildNextLadderRound(3, new Map(), games);

    expect(nextRound.get(1)?.gamePlayerIds).toEqual([1, 2, 11, 12]);
    expect(nextRound.get(2)?.gamePlayerIds).toEqual([5, 6, 3, 4]);
    expect(nextRound.get(3)?.gamePlayerIds).toEqual([9, 10, 7, 8]);
  });
});