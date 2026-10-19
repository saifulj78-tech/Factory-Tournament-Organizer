type StandingLike = {
  teamId: number;
  groupId: number;
  played: number;
  points: number;
  wins: number;
  goalsFor: number;
  goalsAgainst: number;
  rallyDifference?: number;
};

export type QualificationStatus = "automatic" | "additional";

/** Matches the standard standings draw's position-first, then source-group seeding. */
export function getPositionFirstQualifierSeeds(
  groupRows: ReadonlyArray<ReadonlyArray<{ teamId: number }>>,
  statuses: ReadonlyMap<number, QualificationStatus>,
): number[] {
  return groupRows.flatMap((rows, groupIndex) => rows.map((row, position) => ({
    teamId: row.teamId, groupIndex, position,
  }))).filter((row) => statuses.has(row.teamId))
    .sort((a, b) => a.position - b.position || a.groupIndex - b.groupIndex)
    .map((row) => row.teamId);
}

/** The server supplies provisional qualifiers, then freezes actual entrants after generation. */
export function getBreakoutQualificationStatuses(
  brackets: readonly { qualifiers: readonly { teamId: number; position: number }[] }[],
  qualifiersPerGroup: number,
): Map<number, QualificationStatus> {
  const statuses = new Map<number, QualificationStatus>();
  for (const bracket of brackets) {
    for (const qualifier of bracket.qualifiers) {
      statuses.set(qualifier.teamId, qualifier.position < qualifiersPerGroup ? "automatic" : "additional");
    }
  }
  return statuses;
}

export function formatPointsPerGame(points: number, played: number): string {
  return played > 0 ? (points / played).toFixed(2) : "—";
}

export function getQualificationStatuses(
  standings: StandingLike[],
  groupIds: number[],
  qualifiersPerGroup: number,
  wildcardQualifiers: number,
  isTeamEvent: boolean,
  tiebreakerOrder?: string,
  wildcardRankingMethod: "points" | "ppg" = "points",
  selectedAdditionalTeamIds?: readonly number[] | null,
  bracketTeamIds?: readonly number[],
): Map<number, QualificationStatus> {
  const qualified = new Map<number, QualificationStatus>();
  const bracketTeams = bracketTeamIds ? new Set(bracketTeamIds) : null;
  const wildcardCandidates: StandingLike[] = [];
  const genericOrder = (tiebreakerOrder ?? "goal_difference,goals_for,goals_against")
    .split(",")
    .map((key) => key.trim());
  const compare = (a: StandingLike, b: StandingLike) => {
    if (b.points !== a.points) return b.points - a.points;
    if (isTeamEvent) {
      return b.wins - a.wins
        || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)
        || (b.rallyDifference ?? 0) - (a.rallyDifference ?? 0)
        || a.teamId - b.teamId;
    }
    for (const key of genericOrder) {
      if (key === "goal_difference") {
        const difference = (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst);
        if (difference) return difference;
      } else if (key === "goals_for" && b.goalsFor !== a.goalsFor) {
        return b.goalsFor - a.goalsFor;
      } else if (key === "goals_against" && a.goalsAgainst !== b.goalsAgainst) {
        return a.goalsAgainst - b.goalsAgainst;
      }
    }
    return 0;
  };
  const comparePerGame = (a: StandingLike, b: StandingLike) => {
    const aPlayed = Math.max(1, a.played);
    const bPlayed = Math.max(1, b.played);
    const pointsDifference = (b.played > 0 ? b.points : 0) * aPlayed - (a.played > 0 ? a.points : 0) * bPlayed;
    if (pointsDifference) return pointsDifference;
    for (const key of genericOrder) {
      const aMetric = key === "goal_difference" ? a.goalsFor - a.goalsAgainst
        : key === "goals_for" ? a.goalsFor
        : key === "goals_against" ? -a.goalsAgainst : null;
      const bMetric = key === "goal_difference" ? b.goalsFor - b.goalsAgainst
        : key === "goals_for" ? b.goalsFor
        : key === "goals_against" ? -b.goalsAgainst : null;
      if (aMetric != null && bMetric != null) {
        const difference = (b.played > 0 ? bMetric : 0) * aPlayed - (a.played > 0 ? aMetric : 0) * bPlayed;
        if (difference) return difference;
      }
    }
    return 0;
  };

  for (const groupId of groupIds) {
    const rows = standings.filter((row) => row.groupId === groupId);
    rows.slice(0, qualifiersPerGroup).forEach((row) => {
      if (!bracketTeams || bracketTeams.has(row.teamId)) qualified.set(row.teamId, "automatic");
    });
    rows.slice(qualifiersPerGroup).forEach((row, offset) => {
      wildcardCandidates.push({ ...row, qualificationPosition: qualifiersPerGroup + offset } as StandingLike & { qualificationPosition: number });
    });
  }
  if (selectedAdditionalTeamIds !== undefined) {
    const eligibleIds = new Set(wildcardCandidates.map((row) => row.teamId));
    for (const teamId of selectedAdditionalTeamIds ?? []) {
      if (eligibleIds.has(teamId) && (!bracketTeams || bracketTeams.has(teamId))) qualified.set(teamId, "additional");
    }
    return qualified;
  }
  wildcardCandidates
    .sort((a, b) => {
      const aPosition = (a as StandingLike & { qualificationPosition?: number }).qualificationPosition ?? qualifiersPerGroup;
      const bPosition = (b as StandingLike & { qualificationPosition?: number }).qualificationPosition ?? qualifiersPerGroup;
      return aPosition - bPosition
        || (wildcardRankingMethod === "ppg" && !isTeamEvent ? comparePerGame(a, b) : compare(a, b))
        || groupIds.indexOf(a.groupId) - groupIds.indexOf(b.groupId)
        || a.teamId - b.teamId;
    })
    .slice(0, wildcardQualifiers)
    .forEach((row) => qualified.set(row.teamId, "additional"));
  return qualified;
}

export function getQualifiedTeamIds(
  standings: StandingLike[],
  groupIds: number[],
  qualifiersPerGroup: number,
  wildcardQualifiers: number,
  isTeamEvent: boolean,
  tiebreakerOrder?: string,
  wildcardRankingMethod: "points" | "ppg" = "points",
  selectedAdditionalTeamIds?: readonly number[] | null,
): Set<number> {
  return new Set(getQualificationStatuses(
    standings,
    groupIds,
    qualifiersPerGroup,
    wildcardQualifiers,
    isTeamEvent,
    tiebreakerOrder,
    wildcardRankingMethod,
    selectedAdditionalTeamIds,
  ).keys());
}