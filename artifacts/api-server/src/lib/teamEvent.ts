export type TeamEventMatchType =
  | "mens_singles" | "womens_singles" | "mens_doubles" | "womens_doubles" | "mixed_doubles";

export function playerCountFor(type: TeamEventMatchType): number {
  return type.endsWith("singles") ? 1 : 2;
}

export function hasRequiredGenders(
  type: TeamEventMatchType,
  players: Array<{ gender: "male" | "female" }>,
): boolean {
  if (players.length !== playerCountFor(type)) return false;
  if (type.startsWith("mens_")) return players.every((player) => player.gender === "male");
  if (type.startsWith("womens_")) return players.every((player) => player.gender === "female");
  return players.filter((player) => player.gender === "male").length === 1
    && players.filter((player) => player.gender === "female").length === 1;
}

export function pointsForTeamTie(rubbersWon: number, rubbersLost: number): number {
  if (rubbersWon > rubbersLost) return 2;
  if (rubbersWon === rubbersLost) return 1;
  return 0;
}

export function isKnockoutTieClinched(
  homeWins: number,
  awayWins: number,
  remainingRubbers: number,
): boolean {
  return homeWins > awayWins + remainingRubbers
    || awayWins > homeWins + remainingRubbers;
}

export function isValidDreambreakerRotation(
  players: Array<{ id: number; gender: "male" | "female" }>,
): boolean {
  return players.length === 4
    && new Set(players.map((player) => player.id)).size === 4
    && players.filter((player) => player.gender === "male").length === 2
    && players.filter((player) => player.gender === "female").length === 2;
}

/** A scored rubber must have a winner and use its configured scoring format. */
export function isValidRubberScore(
  _targetPoints: number,
  bestOf: number,
  homeScore: number,
  awayScore: number,
): boolean {
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0 || homeScore === awayScore) return false;
  if (bestOf === 1) return true;
  const needed = Math.floor(bestOf / 2) + 1;
  return Math.max(homeScore, awayScore) === needed && Math.min(homeScore, awayScore) < needed;
}

export function validateRubberGames(
  targetPoints: number, bestOf: number, games: Array<{ homeScore: number; awayScore: number }>,
): { homeWins: number; awayWins: number } | null {
  const needed = bestOf === 1 ? 1 : 2;
  if (games.length !== bestOf) {
    if (bestOf !== 3 || games.length < 2 || games.length > 3) return null;
  }
  let homeWins = 0, awayWins = 0;
  for (const game of games) {
    if (!isValidRubberScore(targetPoints, 1, game.homeScore, game.awayScore)) return null;
    if (game.homeScore > game.awayScore) homeWins++; else awayWins++;
    if ((homeWins === needed || awayWins === needed) && games.indexOf(game) !== games.length - 1) return null;
  }
  return homeWins === needed || awayWins === needed ? { homeWins, awayWins } : null;
}