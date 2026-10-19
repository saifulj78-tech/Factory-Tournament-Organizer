import { useParams } from "wouter";
import {
  useListTournamentStandings,
  useGetTeamEventState,
  getGetTeamEventStateQueryKey,
  getListTournamentStandingsQueryKey,
  useGetTournamentById,
  useListTournamentGroups,
  useListKnockoutMatches,
  useGetWildcardPlayoff,
  getGetWildcardPlayoffQueryKey,
  getListKnockoutMatchesQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { formatPointsPerGame, getQualificationStatuses, getBreakoutQualificationStatuses } from "@/lib/qualification";
import { WildcardPlayoffPanel } from "./WildcardPlayoffPanel";
import { isGroupBasedFormat, useBreakoutState } from "./BreakoutKnockouts";

export default function Standings() {
  const { id } = useParams<{ id: string }>();
  const tournamentId = Number(id);
  const { data: tournament } = useGetTournamentById(tournamentId);
  const isTeamEvent = tournament?.format === "team_event";
  const { data: breakoutState } = useBreakoutState(tournamentId, isGroupBasedFormat(tournament?.format));
  const breakoutOn = !!breakoutState?.enabled && isGroupBasedFormat(tournament?.format);
  const breakoutGenerated = breakoutOn && !!breakoutState?.brackets.some((bracket) => bracket.matches.length > 0);

  const { data: genericStandings, isLoading: isLoadingStandings } = useListTournamentStandings(tournamentId, { query: { enabled: !isTeamEvent, queryKey: getListTournamentStandingsQueryKey(tournamentId) } });
  const { data: teamEventState, isLoading: isLoadingTE } = useGetTeamEventState(tournamentId, { query: { enabled: isTeamEvent, queryKey: getGetTeamEventStateQueryKey(tournamentId) } });
  const standings = isTeamEvent ? (teamEventState?.standings ?? []) : (genericStandings ?? []);
  const { data: groups, isLoading: isLoadingGroups } = useListTournamentGroups(tournamentId);
  const showsQualifiers = tournament?.format === "group_knockout" || isTeamEvent || breakoutOn;
  const isWildcardPlayoff = (tournament?.format === "group_knockout" || breakoutOn) && tournament?.wildcardSelectionMethod === "round_robin";
  const { data: wildcardPlayoff } = useGetWildcardPlayoff(tournamentId, { query: { enabled: isWildcardPlayoff, queryKey: getGetWildcardPlayoffQueryKey(tournamentId) } });
  const { data: knockoutMatches = [] } = useListKnockoutMatches(tournamentId, { query: { enabled: isWildcardPlayoff && !breakoutOn, queryKey: getListKnockoutMatchesQueryKey(tournamentId) } });
  const playoffQualifiedIds = knockoutMatches.length > 0
    ? [...new Set(knockoutMatches.flatMap((match) => [match.homeTeamId, match.awayTeamId]).filter((teamId): teamId is number => teamId != null))]
    : (wildcardPlayoff?.qualifiedTeamIds ?? null);
  const thirdPlaceTeamIds = wildcardPlayoff?.matches.length
    ? [...new Set(wildcardPlayoff.matches.flatMap((match) => [match.homeTeamId, match.awayTeamId]))]
    : (groups ?? []).map((group) => standings.filter((row) => row.groupId === group.id)[2]?.teamId).filter((teamId): teamId is number => teamId != null);
  const selectedThirdPlaceTeamIds = thirdPlaceTeamIds.filter((teamId) =>
    breakoutGenerated
      ? breakoutState!.brackets.some((bracket) => bracket.qualifiers.some((qualifier) => qualifier.teamId === teamId))
      : knockoutMatches.some((match) => match.homeTeamId === teamId || match.awayTeamId === teamId));
  const showPPG = (tournament?.format === "group_knockout" || breakoutOn) && tournament?.wildcardRankingMethod === "ppg" && (tournament?.wildcardQualifiers ?? 0) > 0;
  const qualificationStatuses = breakoutOn && breakoutState
    ? getBreakoutQualificationStatuses(breakoutState.brackets, tournament?.qualifiersPerGroup ?? 1)
    : showsQualifiers && groups
    ? getQualificationStatuses(
        standings as any[],
        groups.map((group) => group.id),
        isTeamEvent ? 2 : (tournament?.qualifiersPerGroup ?? 1),
        isTeamEvent ? 0 : (tournament?.wildcardQualifiers ?? 0),
        isTeamEvent,
        tournament?.tiebreakerOrder,
        tournament?.wildcardRankingMethod ?? "points",
        isWildcardPlayoff ? playoffQualifiedIds : undefined,
        isWildcardPlayoff && knockoutMatches.length > 0 ? playoffQualifiedIds ?? [] : undefined,
      )
    : new Map<number, "automatic" | "additional">();

  const isLoading = isLoadingStandings || isLoadingGroups || isLoadingTE;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64 bg-card" />
        <Skeleton className="h-64 bg-card" />
        <Skeleton className="h-64 bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <div>
          <h2 className="text-4xl font-bold display-font text-foreground tracking-wide">STANDINGS</h2>
          {isTeamEvent && (
            <p className="mt-1 text-sm text-muted-foreground">
              TW/TD/TL: team-tie results · IW/IL: individual rubber results · SD: points scored minus points conceded
            </p>
          )}
        </div>
        <p className="text-muted-foreground mt-1">Full standings table by group</p>
        {showsQualifiers && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground" aria-label="Qualification legend">
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-green-400" />Automatic qualifier</span>
            {!isTeamEvent && (tournament?.wildcardQualifiers ?? 0) > 0 && (
              <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />Additional qualifier</span>
            )}
            {isWildcardPlayoff ? <span>The third-place playoff decides the two additional places.</span> : showPPG && <span>Additional qualifiers compared by PPG (points ÷ games played); group positions still use total points.</span>}
          </div>
        )}
      </div>
      {isWildcardPlayoff && (
        <WildcardPlayoffPanel tournamentId={tournamentId} organizer={false} canStart={false} hasBracket={breakoutGenerated || knockoutMatches.length > 0} selectedTeamIds={selectedThirdPlaceTeamIds} onManualSelection={() => {}} />
      )}

      {(!groups || groups.length === 0) && (
        <div className="py-20 text-center border-2 border-dashed border-border rounded-lg">
          <p className="text-muted-foreground mb-4">No standings available yet.</p>
          <a href={`/tournaments/${tournamentId}/settings`} className="text-primary hover:underline font-medium">Generate a tournament to see standings</a>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {groups?.map((group) => {
          const groupStandings = standings?.filter((s) => s.groupId === group.id) ?? [];
          return (
            <Card key={group.id} className="bg-card border border-border overflow-hidden">
              <div className="bg-muted/50 px-6 py-3 border-b border-border">
                <span className="font-bold display-font text-xl tracking-wide text-primary">{group.name}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-background/30">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-8">#</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Team</th>
                      <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">P</th>
                      {isTeamEvent ? (
                        <>
                           <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider" title="Team-tie wins">TW</th>
                           <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider" title="Team-tie draws">TD</th>
                           <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider" title="Team-tie losses">TL</th>
                           <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider" title="Individual rubber wins">IW</th>
                           <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider" title="Individual rubber losses">IL</th>
                           <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider" title="Individual rubber difference">ID</th>
                           <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider" title="Score difference: points scored minus points conceded">SD</th>
                        </>
                      ) : (
                        <>
                           <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">W</th>
                           <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">D</th>
                           <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">L</th>
                          <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">GF</th>
                          <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">GA</th>
                          <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">GD</th>
                        </>
                      )}
                      <th className="text-center px-4 py-3 text-xs font-semibold text-primary uppercase tracking-wider">PTS</th>
                       {showPPG && <th className="text-center px-3 py-3 text-xs font-semibold text-primary uppercase tracking-wider" title="Points per game: points divided by games played">PPG</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {groupStandings.map((standing, idx) => {
                      const gd = standing.goalsFor - standing.goalsAgainst;
                      const isFirst = idx === 0;
                      const qualificationStatus = qualificationStatuses.get(standing.teamId);
                      const qualifierColor = qualificationStatus === "additional" ? "text-yellow-400" : qualificationStatus === "automatic" ? "text-green-400" : "";
                      return (
                        <tr
                          key={standing.teamId}
                          className={`border-b border-border/50 transition-colors hover:bg-accent/20 ${qualificationStatus === "additional" ? "bg-yellow-500/5" : qualificationStatus === "automatic" ? "bg-green-500/5" : isFirst ? "bg-primary/5" : ""}`}
                        >
                          <td className={`px-4 py-3 text-xs mono-font ${qualifierColor || "text-muted-foreground"}`}>{idx + 1}</td>
                          <td className="px-4 py-3">
                            <span className={`font-semibold ${qualifierColor || (isFirst ? "text-primary" : "text-foreground")}`}>
                              {standing.teamName}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center mono-font text-muted-foreground">{standing.played}</td>
                          {isTeamEvent ? (
    <>
       <td className="px-3 py-3 text-center mono-font text-green-400">{standing.wins}</td>
                           <td className="px-3 py-3 text-center mono-font text-amber-400">{standing.draws}</td>
                           <td className="px-3 py-3 text-center mono-font text-red-400">{standing.losses}</td>
                           <td className="px-3 py-3 text-center mono-font text-green-400">{standing.goalsFor}</td>
                           <td className="px-3 py-3 text-center mono-font text-red-400">{standing.goalsAgainst}</td>
                           <td className={`px-3 py-3 text-center mono-font font-medium ${gd > 0 ? "text-green-400" : gd < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                             {gd > 0 ? `+${gd}` : gd}
                           </td>
                          <td className={`px-3 py-3 text-center mono-font font-medium ${(standing as any).rallyDifference > 0 ? "text-green-400" : (standing as any).rallyDifference < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                            {(standing as any).rallyDifference > 0 ? `+${(standing as any).rallyDifference}` : (standing as any).rallyDifference}
                          </td>
    </>
  ) : (
    <>
       <td className="px-3 py-3 text-center mono-font text-green-400">{standing.wins}</td>
                           <td className="px-3 py-3 text-center mono-font text-muted-foreground">{standing.draws}</td>
                           <td className="px-3 py-3 text-center mono-font text-red-400">{standing.losses}</td>
      <td className="px-3 py-3 text-center mono-font text-foreground">{standing.goalsFor}</td>
                          <td className="px-3 py-3 text-center mono-font text-foreground">{standing.goalsAgainst}</td>
                          <td className={`px-3 py-3 text-center mono-font font-medium ${gd > 0 ? "text-green-400" : gd < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                            {gd > 0 ? `+${gd}` : gd}
                          </td>
    </>
  )}
                          <td className="px-4 py-3 text-center">
                            <span className={`text-lg font-bold mono-font ${qualifierColor || (isFirst ? "text-primary" : "text-foreground")}`}>
                              {standing.points}
                            </span>
                          </td>
                          {showPPG && <td className="px-3 py-3 text-center mono-font text-sm text-foreground">{formatPointsPerGame(standing.points, standing.played)}</td>}
                        </tr>
                      );
                    })}
                    {groupStandings.length === 0 && (
                      <tr>
                        <td colSpan={isTeamEvent ? 11 : showPPG ? 11 : 10} className="px-4 py-8 text-center text-muted-foreground text-sm">
                          No standings data yet. Enter match scores to see standings.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
