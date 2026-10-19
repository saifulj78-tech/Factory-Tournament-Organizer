export type WildcardCandidate = {
  teamId: number;
  groupIndex: number;
  position: number;
  pts: number;
  gf: number;
  ga: number;
  played: number;
};

type Tiebreaker = "goal_difference" | "goals_for" | "goals_against" | "head_to_head";

function compareRates(
  aValue: number,
  aPlayed: number,
  bValue: number,
  bPlayed: number,
  descending: boolean,
): number {
  // Treat a zero-played team's rate as zero without dividing by zero.
  const aNumerator = aPlayed > 0 ? aValue : 0;
  const aDenominator = aPlayed > 0 ? aPlayed : 1;
  const bNumerator = bPlayed > 0 ? bValue : 0;
  const bDenominator = bPlayed > 0 ? bPlayed : 1;
  const difference = descending
    ? bNumerator * aDenominator - aNumerator * bDenominator
    : aNumerator * bDenominator - bNumerator * aDenominator;
  return difference;
}

/** Compare same-position wildcard candidates; finishing position always has priority. */
export function compareWildcardCandidates(
  a: WildcardCandidate,
  b: WildcardCandidate,
  method: "points" | "ppg",
  tiebreakers: readonly Tiebreaker[],
): number {
  if (a.position !== b.position) return a.position - b.position;

  if (method === "ppg") {
    const pointsPerGame = compareRates(a.pts, a.played, b.pts, b.played, true);
    if (pointsPerGame !== 0) return pointsPerGame;
  } else if (a.pts !== b.pts) {
    return b.pts - a.pts;
  }

  for (const key of tiebreakers) {
    if (key === "goal_difference") {
      const aValue = a.gf - a.ga;
      const bValue = b.gf - b.ga;
      const difference = method === "ppg"
        ? compareRates(aValue, a.played, bValue, b.played, true)
        : bValue - aValue;
      if (difference !== 0) return difference;
    } else if (key === "goals_for") {
      const difference = method === "ppg"
        ? compareRates(a.gf, a.played, b.gf, b.played, true)
        : b.gf - a.gf;
      if (difference !== 0) return difference;
    } else if (key === "goals_against") {
      const difference = method === "ppg"
        ? compareRates(a.ga, a.played, b.ga, b.played, false)
        : a.ga - b.ga;
      if (difference !== 0) return difference;
    }
    // Head-to-head cannot compare candidates from separate groups.
  }

  return a.groupIndex - b.groupIndex || a.teamId - b.teamId;
}