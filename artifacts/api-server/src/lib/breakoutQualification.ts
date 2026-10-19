import { inArray } from "drizzle-orm";
import { db, groupsTable, matchesTable, teamsTable, tournamentTable } from "@workspace/db";
import { getSortedQualifiers, getThirdPlaceTeams, getWildcardPlayoffState } from "../routes/tournament";

/** Use the existing standings, wildcard and playoff criteria before routing qualifiers by source group. */
export async function getBreakoutQualification(
  tournament: typeof tournamentTable.$inferSelect,
  groups: typeof groupsTable.$inferSelect[],
  database: Pick<typeof db, "select"> = db,
) {
  type Qualifier = { teamId: number; teamName: string; groupId: number; position: number };
  if (!tournament.qualifiersPerGroup || tournament.qualifiersPerGroup < 1) {
    return { qualifiers: [] as Qualifier[], ready: false, message: "Set qualifiers per group in Settings before generating knockout brackets." };
  }
  const groupIds = groups.map((group) => group.id);
  const matches = groupIds.length ? await database.select().from(matchesTable).where(inArray(matchesTable.groupId, groupIds)) : [];
  const unfinished = matches.filter((match) => !match.played || match.homeScore === null || match.awayScore === null).length;
  let message: string | null = matches.length === 0 ? "Generate and complete the group fixtures first."
    : unfinished ? `${unfinished} group match(es) still unplayed. Automatic qualification is provisional.` : null;
  let ranked = await getSortedQualifiers(tournament, database);

  if (tournament.wildcardSelectionMethod === "round_robin") {
    // Ranking-mode wildcard candidates must not qualify while a playoff is unresolved.
    ranked = ranked.filter((qualifier) => qualifier.position < 2);
    if (groups.length !== 3 || tournament.qualifiersPerGroup !== 2 || tournament.wildcardQualifiers !== 2) {
      message = "The third-place playoff requires three groups, two qualifiers per group and two wildcard places.";
    } else {
      const playoff = await getWildcardPlayoffState(tournament.id, database);
      if (!playoff.qualifiedTeamIds) {
        message ??= playoff.tieAtCutoff
          ? "The wildcard playoff is tied at the cutoff. Resolve qualification with manual seeding."
          : "Complete the third-place playoff before generating the knockout brackets.";
      } else {
        const currentThirdPlace = await getThirdPlaceTeams(tournament, database);
        const entrants = new Set(playoff.matches.flatMap((match) => [match.homeTeamId, match.awayTeamId]));
        if (currentThirdPlace.candidates.length !== 3 || currentThirdPlace.candidates.some((candidate) => !entrants.has(candidate.teamId))) {
          message = "Group standings changed after the playoff began. Reset the third-place playoff or seed manually.";
        } else {
          const teams = await database.select().from(teamsTable).where(inArray(teamsTable.groupId, groupIds));
          const byId = new Map(teams.map((team) => [team.id, team]));
          const additional = playoff.qualifiedTeamIds.map((teamId) => {
            const team = byId.get(teamId);
            return team ? { teamId, teamName: team.name, groupIndex: groups.findIndex((group) => group.id === team.groupId), position: 2 } : null;
          });
          if (additional.some((qualifier) => qualifier === null)) message = "A playoff qualifier is no longer in this tournament.";
          else ranked = [...ranked, ...additional.filter((qualifier): qualifier is NonNullable<typeof qualifier> => qualifier !== null)];
        }
      }
    }
  }
  return {
    qualifiers: ranked.flatMap((qualifier) => {
      const group = groups[qualifier.groupIndex];
      return group ? [{ teamId: qualifier.teamId, teamName: qualifier.teamName, groupId: group.id, position: qualifier.position }] : [];
    }),
    ready: message === null,
    message,
  };
}
