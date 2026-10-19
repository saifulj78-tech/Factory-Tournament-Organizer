export type StoredBreakoutScore = {
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
};

export type ComputedBreakoutMatch = {
  id: number;
  round: number;
  matchNumber: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  winnerId: number | null;
  played: boolean;
  ready: boolean;
  bye: boolean;
};

/** Stable balanced seed positions: first plays last, byes belong to high seeds. */
function seedOrder(size: number): number[] {
  let positions = [1, 2];
  for (let n = 4; n <= size; n *= 2) {
    positions = positions.flatMap((seed) => [seed, n + 1 - seed]);
  }
  return positions;
}

/** Rebuild the tree from its original draw. Stale downstream results are discarded. */
export function computeBreakoutBracket(seeds: readonly number[], scores: Record<string, StoredBreakoutScore>) {
  const matches: ComputedBreakoutMatch[] = [];
  const validScores: Record<string, StoredBreakoutScore> = {};
  if (seeds.length < 2) return { matches, validScores, winnerTeamId: null };
  let size = 2;
  while (size < seeds.length) size *= 2;
  let entries: { teamId: number | null; resolved: boolean }[] = seedOrder(size)
    .map((seed) => ({ teamId: seeds[seed - 1] ?? null, resolved: true }));
  let round = 1;
  while (entries.length > 1) {
    const next: typeof entries = [];
    for (let i = 0; i < entries.length; i += 2) {
      const home = entries[i];
      const away = entries[i + 1];
      const id = matches.length + 1;
      const stored = scores[String(id)];
      const ready = home.resolved && away.resolved;
      const validScore = ready && home.teamId !== null && away.teamId !== null &&
        stored?.homeTeamId === home.teamId && stored.awayTeamId === away.teamId &&
        Number.isInteger(stored.homeScore) && stored.homeScore >= 0 &&
        Number.isInteger(stored.awayScore) && stored.awayScore >= 0 &&
        stored.homeScore !== stored.awayScore ? stored : null;
      const bye = ready && (home.teamId === null || away.teamId === null);
      const winnerId = validScore
        ? (validScore.homeScore > validScore.awayScore ? home.teamId : away.teamId)
        : bye ? home.teamId ?? away.teamId : null;
      if (validScore) validScores[String(id)] = validScore;
      matches.push({
        id, round, matchNumber: i / 2 + 1,
        homeTeamId: home.teamId, awayTeamId: away.teamId,
        homeScore: validScore?.homeScore ?? null, awayScore: validScore?.awayScore ?? null,
        winnerId, played: !!validScore, ready, bye,
      });
      next.push({ teamId: winnerId, resolved: bye || !!validScore });
    }
    entries = next;
    round++;
  }
  return { matches, validScores, winnerTeamId: entries[0]?.resolved ? entries[0].teamId : null };
}

export function validBreakoutGroups(brackets: readonly { groupIds: readonly number[] }[], allowed: ReadonlySet<number>) {
  const ids = brackets.flatMap((bracket) => [...bracket.groupIds]);
  return brackets.length === 2 && brackets.every((bracket) => bracket.groupIds.length > 0) &&
    ids.every((id) => Number.isInteger(id) && allowed.has(id)) && new Set(ids).size === ids.length;
}
