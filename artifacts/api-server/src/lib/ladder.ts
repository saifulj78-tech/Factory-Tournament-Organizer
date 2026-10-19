import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  ladderCourtsTable,
  ladderGamesTable,
  ladderParticipantsTable,
} from "@workspace/db";

type LadderGameRow = typeof ladderGamesTable.$inferSelect;
type LadderParticipantRow = typeof ladderParticipantsTable.$inferSelect;
type LadderCourtRow = typeof ladderCourtsTable.$inferSelect;

function asParticipant(player: LadderParticipantRow, fallbackSeed = player.id) {
  return {
    id: player.id,
    tournamentId: player.tournamentId,
    seed: player.seed ?? fallbackSeed,
    name: player.name,
    isHere: player.isHere,
  };
}

function asGame(
  game: LadderGameRow,
  playersById: Map<number, LadderParticipantRow>,
  courtCount: number,
  fallbackSeedsById: Map<number, number>,
  format: "individual_ladder" | "americano",
) {
  const player = (id: number) => {
    const result = playersById.get(id);
    if (!result) throw new Error(`Ladder player ${id} is missing`);
    return asParticipant(result, fallbackSeedsById.get(id));
  };

  return {
    id: game.id,
    tournamentId: game.tournamentId,
    batchNumber: game.batchNumber,
    courtNumber: game.courtNumber,
    homeTeam: { players: [player(game.homePlayerOneId), player(game.homePlayerTwoId)] },
    awayTeam: { players: [player(game.awayPlayerOneId), player(game.awayPlayerTwoId)] },
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    played: game.played,
    winnerMovement: format === "americano" ? null : (game.winnerMovement ?? winnerMovement(game.courtNumber, courtCount)),
    loserMovement: format === "americano" ? null : (game.loserMovement ?? loserMovement(game.courtNumber, courtCount)),
  };
}

/**
 * Get the public ladder representation. A court exposes its game in the most
 * recent batch even after it is scored, so everyone can see it is waiting for
 * the other courts before the synchronized next batch is formed.
 */
export async function getLadderState(
  tournamentId: number,
  courtCount: number,
  format: "individual_ladder" | "americano" = "individual_ladder",
) {
  const [participants, courts, games] = await Promise.all([
    db.select().from(ladderParticipantsTable)
      .where(eq(ladderParticipantsTable.tournamentId, tournamentId))
      .orderBy(asc(ladderParticipantsTable.seed), asc(ladderParticipantsTable.id)),
    db.select().from(ladderCourtsTable)
      .where(eq(ladderCourtsTable.tournamentId, tournamentId))
      .orderBy(asc(ladderCourtsTable.courtNumber)),
    db.select().from(ladderGamesTable)
      .where(eq(ladderGamesTable.tournamentId, tournamentId))
      .orderBy(desc(ladderGamesTable.batchNumber), asc(ladderGamesTable.courtNumber)),
  ]);

  return serializeLadderState(tournamentId, courtCount, participants, courts, games, format);
}

export function serializeLadderState(
  tournamentId: number,
  courtCount: number,
  participants: LadderParticipantRow[],
  courts: LadderCourtRow[],
  games: LadderGameRow[],
  format: "individual_ladder" | "americano" = "individual_ladder",
) {
  const playersById = new Map(participants.map((participant) => [participant.id, participant]));
  const fallbackSeedsById = new Map(participants.map((participant, index) => [participant.id, index + 1]));
  const serializedGames = games.map((game) => asGame(game, playersById, courtCount, fallbackSeedsById, format));
  const currentBatchNumber = games.reduce((highest, game) => Math.max(highest, game.batchNumber), 0);
  const activeGameByCourt = new Map(
    serializedGames
      .filter((game) => game.batchNumber === currentBatchNumber)
      .map((game) => [game.courtNumber, game]),
  );
  const courtByNumber = new Map(courts.map((court) => [court.courtNumber, court]));

  return {
    tournamentId,
    courtCount,
    started: games.length > 0,
    batchNumber: currentBatchNumber,
    participants: participants.map((participant, index) => asParticipant(participant, index + 1)),
    standings: buildLadderStandings(participants, games, format),
    courts: Array.from({ length: courtCount }, (_, index) => {
      const courtNumber = index + 1;
      const court = courtByNumber.get(courtNumber);
      const waitingPlayers = (court?.queuePlayerIds ?? [])
        .map((playerId) => playersById.get(playerId))
        .filter((player): player is LadderParticipantRow => Boolean(player))
        .map((player) => asParticipant(player, fallbackSeedsById.get(player.id)));
      return {
        courtNumber,
        activeGame: activeGameByCourt.get(courtNumber) ?? null,
        waitingPlayers,
      };
    }),
    history: serializedGames.filter((game) => game.played),
  };
}

export function splitAcrossCourts(playerIds: number[], courtCount: number): number[][] {
  if (courtCount === 3) {
    return [
      [...playerIds.slice(0, 4), ...playerIds.slice(8, 12)],
      playerIds.slice(4, 8),
      playerIds.slice(12),
    ];
  }
  const courts = Array.from({ length: courtCount }, () => [] as number[]);
  playerIds.forEach((playerId, index) => courts[index % courtCount].push(playerId));
  return courts;
}

export function pointsForCourt(courtNumber: number): number {
  return Math.max(8 - (courtNumber * 2), 0);
}

export function buildLadderStandings(
  participants: LadderParticipantRow[],
  games: LadderGameRow[],
  format: "individual_ladder" | "americano" = "individual_ladder",
) {
  const seededParticipants = participants.map((player, index) => ({
    player,
    seed: player.seed ?? index + 1,
  }));
  const totals = new Map(participants.map((player) => [
    player.id,
    { points: 0, wins: 0, losses: 0, gamesPlayed: 0, currentWinStreak: 0 },
  ]));

  for (const game of games) {
    if (!game.played || game.homeScore === null || game.awayScore === null) continue;
    if (format === "americano") {
      const homeIds = [game.homePlayerOneId, game.homePlayerTwoId];
      const awayIds = [game.awayPlayerOneId, game.awayPlayerTwoId];
      for (const playerId of homeIds) {
        const total = totals.get(playerId);
        if (total) {
          total.points += game.homeScore;
          total.wins += game.homeScore > game.awayScore ? 1 : 0;
          total.losses += game.homeScore < game.awayScore ? 1 : 0;
          total.gamesPlayed += 1;
        }
      }
      for (const playerId of awayIds) {
        const total = totals.get(playerId);
        if (total) {
          total.points += game.awayScore;
          total.wins += game.awayScore > game.homeScore ? 1 : 0;
          total.losses += game.awayScore < game.homeScore ? 1 : 0;
          total.gamesPlayed += 1;
        }
      }
      continue;
    }
    const winners = winningPlayers(game);
    const losers = losingPlayers(game);
    const points = pointsForCourt(game.courtNumber);
    for (const playerId of winners) {
      const total = totals.get(playerId);
      if (total) {
        total.points += points;
        total.wins += 1;
        total.gamesPlayed += 1;
      }
    }
    for (const playerId of losers) {
      const total = totals.get(playerId);
      if (total) {
        total.losses += 1;
        total.gamesPlayed += 1;
      }
    }
  }

  const streakStillActive = new Set(format === "americano" ? [] : participants.map((player) => player.id));
  const newestGamesFirst = games
    .filter((game) => game.played && game.homeScore !== null && game.awayScore !== null)
    .sort((a, b) => b.batchNumber - a.batchNumber || b.id - a.id);
  for (const game of newestGamesFirst) {
    const winners = new Set(winningPlayers(game));
    for (const playerId of [...winningPlayers(game), ...losingPlayers(game)]) {
      if (!streakStillActive.has(playerId)) continue;
      if (winners.has(playerId)) {
        const total = totals.get(playerId);
        if (total) total.currentWinStreak += 1;
      } else {
        streakStillActive.delete(playerId);
      }
    }
  }

  const sorted = seededParticipants
    .map(({ player, seed }) => ({ player, seed, ...totals.get(player.id)! }))
    .sort((a, b) =>
      b.points - a.points
      || a.seed - b.seed
      || a.player.id - b.player.id,
    );

  return sorted.map((entry, index) => ({
    rank: index + 1,
    player: asParticipant(entry.player, entry.seed),
    points: entry.points,
    wins: entry.wins,
    losses: entry.losses,
    gamesPlayed: entry.gamesPlayed,
    currentWinStreak: entry.currentWinStreak,
  }));
}

/** Builds one Americano round where every player partners every other player once. */
export function buildAmericanoRound(playerIds: number[], roundIndex: number): number[][] {
  if (playerIds.length < 4 || playerIds.length % 4 !== 0) return [];
  const rotation = [...playerIds];
  for (let index = 0; index < roundIndex; index++) {
    rotation.splice(1, 0, rotation.pop()!);
  }
  const teams = Array.from({ length: rotation.length / 2 }, (_, index) => [
    rotation[index],
    rotation[rotation.length - 1 - index],
  ]);
  return Array.from({ length: teams.length / 2 }, (_, index) => [
    ...teams[index * 2],
    ...teams[index * 2 + 1],
  ]);
}

export function buildAmericanoRoundAvoidingPartners(
  playerIds: number[],
  usedPartnerPairs: Set<string>,
  preferredRoundIndex: number,
): number[][] {
  const pairKey = (first: number, second: number) => [first, second].sort((a, b) => a - b).join(":");
  const preferred = buildAmericanoRound(playerIds, preferredRoundIndex);
  if (preferred.length > 0 && preferred.every(([a, b, c, d]) =>
    !usedPartnerPairs.has(pairKey(a, b)) && !usedPartnerPairs.has(pairKey(c, d))
  )) return preferred;

  const findTeams = (remaining: number[], teams: number[][]): number[][] | null => {
    if (remaining.length === 0) return teams;
    const [first, ...rest] = remaining;
    for (let index = 0; index < rest.length; index++) {
      const partner = rest[index];
      if (usedPartnerPairs.has(pairKey(first, partner))) continue;
      const next = rest.filter((_, candidateIndex) => candidateIndex !== index);
      const result = findTeams(next, [...teams, [first, partner]]);
      if (result) return result;
    }
    return null;
  };

  const teams = findTeams(playerIds, []);
  if (!teams) return [];
  return Array.from({ length: teams.length / 2 }, (_, index) => [
    ...teams[index * 2],
    ...teams[index * 2 + 1],
  ]);
}

/**
 * Builds a mixed-partner doubles game from the front of a court pool. The
 * Four longest-waiting players enter first. Later movement pools alternate
 * players between teams; the seeded opening round can request balanced pairs.
 */
export function takeNextGame(playerIds: number[], balancedOpening = false) {
  if (playerIds.length < 4) return null;
  return {
    homePlayerOneId: playerIds[0],
    homePlayerTwoId: balancedOpening ? playerIds[3] : playerIds[2],
    awayPlayerOneId: playerIds[1],
    awayPlayerTwoId: balancedOpening ? playerIds[2] : playerIds[3],
    queuePlayerIds: playerIds.slice(4),
  };
}

export function winningPlayers(game: LadderGameRow): number[] {
  if (game.homeScore === null || game.awayScore === null) return [];
  return game.homeScore > game.awayScore
    ? [game.homePlayerOneId, game.homePlayerTwoId]
    : [game.awayPlayerOneId, game.awayPlayerTwoId];
}

export function losingPlayers(game: LadderGameRow): number[] {
  if (game.homeScore === null || game.awayScore === null) return [];
  return game.homeScore > game.awayScore
    ? [game.awayPlayerOneId, game.awayPlayerTwoId]
    : [game.homePlayerOneId, game.homePlayerTwoId];
}

export function winnerMovement(courtNumber: number, courtCount: number): "stay" | "up" {
  return courtCount === 3 && courtNumber > 1 ? "up" : "stay";
}

export function loserMovement(courtNumber: number, courtCount: number): "stay" | "down" {
  return "down";
}

export function buildNextLadderRound(
  courtCount: number,
  queuesByCourt: Map<number, number[]>,
  gamesByCourt: Map<number, LadderGameRow>,
): Map<number, { gamePlayerIds: number[]; queuePlayerIds: number[] }> {
  if (courtCount === 3) {
    const courtOne = gamesByCourt.get(1);
    const courtTwo = gamesByCourt.get(2);
    const courtThree = gamesByCourt.get(3);
    const benchOne = queuesByCourt.get(1) ?? [];
    const benchTwo = queuesByCourt.get(3) ?? [];

    if (courtOne && courtTwo && courtThree && benchOne.length >= 2 && benchTwo.length >= 2) {
      const courtThreeLosersNeeded = Math.max(0, 4 - benchTwo.length);
      return new Map([
        [1, {
          gamePlayerIds: [...winningPlayers(courtOne), ...winningPlayers(courtTwo)],
          queuePlayerIds: [...benchOne.slice(2), ...losingPlayers(courtOne)],
        }],
        [2, {
          gamePlayerIds: [
            winningPlayers(courtThree)[0],
            benchOne[0],
            winningPlayers(courtThree)[1],
            benchOne[1],
          ],
          queuePlayerIds: [],
        }],
        [3, {
          gamePlayerIds: [
            ...benchTwo.slice(0, 4),
            ...losingPlayers(courtThree).slice(0, courtThreeLosersNeeded),
          ],
          queuePlayerIds: [
            ...benchTwo.slice(4),
            ...losingPlayers(courtTwo),
            ...losingPlayers(courtThree).slice(courtThreeLosersNeeded),
          ],
        }],
      ]);
    }
  }

  return new Map(Array.from({ length: courtCount }, (_, index) => {
    const courtNumber = index + 1;
    const gamePlayerIds = movementPool(courtNumber, courtCount, queuesByCourt, gamesByCourt);
    const nextGame = takeNextGame(gamePlayerIds);
    return [courtNumber, {
      gamePlayerIds,
      queuePlayerIds: nextGame?.queuePlayerIds ?? gamePlayerIds,
    }];
  }));
}

export function movementPool(
  courtNumber: number,
  courtCount: number,
  queuesByCourt: Map<number, number[]>,
  gamesByCourt: Map<number, LadderGameRow>,
): number[] {
  const currentQueue = queuesByCourt.get(courtNumber) ?? [];
  const pool: number[] = [];

  // Winners go first so takeNextGame splits them onto opposite teams.
  const currentGame = gamesByCourt.get(courtNumber);
  if (currentGame) pool.push(...winningPlayers(currentGame));
  pool.push(...currentQueue);

  // Losers arrive from the court above; bottom-court losers cycle to court 1.
  if (courtNumber > 1) {
    const upperGame = gamesByCourt.get(courtNumber - 1);
    if (upperGame) pool.push(...losingPlayers(upperGame));
  } else {
    const bottomGame = gamesByCourt.get(courtCount);
    if (bottomGame) pool.push(...losingPlayers(bottomGame));
  }

  return pool;
}

export async function getParticipantsForTournament(tournamentId: number) {
  return db.select().from(ladderParticipantsTable)
    .where(eq(ladderParticipantsTable.tournamentId, tournamentId))
    .orderBy(asc(ladderParticipantsTable.seed), asc(ladderParticipantsTable.id));
}

export async function ladderGamesForTournament(tournamentId: number) {
  return db.select().from(ladderGamesTable)
    .where(eq(ladderGamesTable.tournamentId, tournamentId))
    .orderBy(asc(ladderGamesTable.batchNumber), asc(ladderGamesTable.courtNumber));
}

export async function playerIdsExist(tournamentId: number, ids: number[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const found = await db.select({ id: ladderParticipantsTable.id })
    .from(ladderParticipantsTable)
    .where(inArray(ladderParticipantsTable.id, ids));
  return found.length === ids.length;
}