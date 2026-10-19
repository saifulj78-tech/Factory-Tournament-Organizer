import type { knockoutMatchesTable } from "@workspace/db";

type Match = typeof knockoutMatchesTable.$inferSelect;

/** Rebuild the affected path of a single-elimination bracket after removing a team.
 * Unrelated played results stay intact. A remaining opponent gets a bye only once
 * the missing slot's source is final. */
export function reconcileSingleEliminationTeamChange(
  rows: Match[],
  oldId: number,
  replacementId: number | null,
) {
  const matches = new Map(rows.map(row => [row.id, { ...row }]));
  const changed = new Set<number>();
  const rounds = ["r32", "r16", "quarter", "semi", "final"]
    .filter(round => rows.some(row => row.round === round));
  const nextMatch = (match: Match) => {
    const index = rounds.indexOf(match.round);
    if (index < 0 || index === rounds.length - 1) return null;
    return [...matches.values()].find(row =>
      row.round === rounds[index + 1] && row.matchNumber === Math.ceil(match.matchNumber / 2)) ?? null;
  };
  const reset = (match: Match, seen = new Set<number>()) => {
    if (seen.has(match.id)) return;
    seen.add(match.id);
    const winner = match.winnerId;
    const loser = winner == null ? null : match.homeTeamId === winner ? match.awayTeamId : match.homeTeamId;
    const wasPlayed = match.played;
    Object.assign(match, { homeScore: null, awayScore: null, winnerId: null, played: false, startedAt: null });
    changed.add(match.id);
    if (!wasPlayed) return;
    const child = nextMatch(match);
    if (child && winner != null) {
      const slot = match.matchNumber % 2 ? "homeTeamId" : "awayTeamId";
      if (child[slot] === winner) child[slot] = null;
      reset(child, seen);
    }
    if (match.round === "semi" && loser != null) {
      const third = [...matches.values()].find(row => row.round === "third_place");
      if (third) {
        const slot = match.matchNumber % 2 ? "homeTeamId" : "awayTeamId";
        if (third[slot] === loser) third[slot] = null;
        reset(third, seen);
      }
    }
  };

  const affected = rows.filter(row =>
    row.homeTeamId === oldId || row.awayTeamId === oldId || row.winnerId === oldId);
  for (const original of affected) {
    if (original.played || original.winnerId != null ||
        original.homeScore != null || original.awayScore != null) {
      reset(matches.get(original.id)!);
    }
  }
  for (const match of matches.values()) {
    if (match.homeTeamId === oldId) { match.homeTeamId = replacementId; changed.add(match.id); }
    if (match.awayTeamId === oldId) { match.awayTeamId = replacementId; changed.add(match.id); }
    if (match.winnerId === oldId) { match.winnerId = null; changed.add(match.id); }
  }

  if (replacementId === null) {
    // A deleted participant becomes a bye. Never auto-advance past a source
    // match that has yet to finish.
    for (const round of [...rounds, "third_place"]) {
      for (const match of matches.values()) {
        if (match.round !== round || match.played) continue;
        const soleTeam = match.homeTeamId ?? match.awayTeamId;
        if (match.homeTeamId != null && match.awayTeamId != null) continue;
        const previous = round === "third_place" ? "semi" : rounds[rounds.indexOf(round) - 1];
        const sources = previous
          ? [...matches.values()].filter(row => row.round === previous &&
              (row.matchNumber === match.matchNumber * 2 - 1 || row.matchNumber === match.matchNumber * 2))
          : [];
        if (sources.some(source => !source.played)) continue;
        match.played = true;
        match.winnerId = soleTeam;
        match.homeScore = null;
        match.awayScore = null;
        match.startedAt = null;
        changed.add(match.id);
        if (round !== "third_place" && soleTeam != null) {
          const child = nextMatch(match);
          if (child) {
            const slot = match.matchNumber % 2 ? "homeTeamId" : "awayTeamId";
            child[slot] = soleTeam;
            changed.add(child.id);
          }
        }
      }
    }
  }

  return {
    matches,
    changedIds: [...changed],
    scoresCleared: rows.filter(row => changed.has(row.id) &&
      (row.homeScore != null || row.awayScore != null)).length,
  };
}