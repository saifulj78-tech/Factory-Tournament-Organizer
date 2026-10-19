export type PlayoffTeam = { id: number; name: string; groupId?: number };

export type PlayoffMatchScore = {
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  played: boolean;
};

export type PlayoffStanding = {
  teamId: number;
  teamName: string;
  played: number;
  wins: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
};

export function calculateWildcardPlayoffStandings(
  matches: PlayoffMatchScore[],
  teams: Array<{ id: number; name: string }>,
) {
  const table = new Map<number, PlayoffStanding>();
  for (const team of teams) {
    table.set(team.id, {
      teamId: team.id,
      teamName: team.name,
      played: 0,
      wins: 0,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
    });
  }
  for (const match of matches) {
    if (!match.played || match.homeScore == null || match.awayScore == null) continue;
    const home = table.get(match.homeTeamId);
    const away = table.get(match.awayTeamId);
    if (!home || !away) continue;
    home.played++;
    away.played++;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;
    if (match.homeScore > match.awayScore) {
      home.wins++;
      home.points += 3;
    } else if (match.awayScore > match.homeScore) {
      away.wins++;
      away.points += 3;
    }
  }
  const standings = [...table.values()].map((row) => ({
    ...row,
    goalDifference: row.goalsFor - row.goalsAgainst,
  })).sort((a, b) =>
    b.wins - a.wins
    || b.points - a.points
    || b.goalDifference - a.goalDifference
    || b.goalsFor - a.goalsFor
    || a.teamId - b.teamId,
  );
  const complete = matches.length === 3 && matches.every((match) =>
    match.played && match.homeScore != null && match.awayScore != null,
  );
  const tieAtCutoff = complete && standings.length >= 3
    && standings[1].wins === standings[2].wins
    && standings[1].points === standings[2].points
    && standings[1].goalDifference === standings[2].goalDifference
    && standings[1].goalsFor === standings[2].goalsFor;
  return {
    standings,
    qualifiedTeamIds: complete && !tieAtCutoff ? standings.slice(0, 2).map((row) => row.teamId) : null,
    tieAtCutoff,
  };
}

export function selectThirdPlaceCandidates<
  TTeam extends PlayoffTeam & { groupId: number },
  TMatch extends PlayoffMatchScore & { groupId: number },
  TGroup extends { id: number },
>(
  groups: TGroup[],
  teams: TTeam[],
  playedMatches: TMatch[],
  compare: (a: { teamId: number; pts: number; gf: number; ga: number; groupId: number },
    b: { teamId: number; pts: number; gf: number; ga: number; groupId: number }) => number,
): Array<{ teamId: number; teamName: string }> {
  type Row = { teamId: number; teamName: string; groupId: number; pts: number; gf: number; ga: number };
  const table = new Map<number, Row>();
  for (const team of teams) {
    table.set(team.id, {
      teamId: team.id, teamName: team.name, groupId: team.groupId, pts: 0, gf: 0, ga: 0,
    });
  }
  for (const match of playedMatches) {
    if (!match.played || match.homeScore == null || match.awayScore == null) continue;
    const home = table.get(match.homeTeamId);
    const away = table.get(match.awayTeamId);
    if (!home || !away) continue;
    home.gf += match.homeScore;
    home.ga += match.awayScore;
    away.gf += match.awayScore;
    away.ga += match.homeScore;
    if (match.homeScore > match.awayScore) home.pts += 3;
    else if (match.awayScore > match.homeScore) away.pts += 3;
  }
  return groups.flatMap((group) => {
    const ranked = [...table.values()].filter((row) => row.groupId === group.id).sort(compare);
    return ranked[2] ? [{ teamId: ranked[2].teamId, teamName: ranked[2].teamName }] : [];
  });
}