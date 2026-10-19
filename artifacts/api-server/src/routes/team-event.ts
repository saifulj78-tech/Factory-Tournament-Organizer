import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  db, groupsTable, knockoutMatchesTable, matchesTable, teamEventConfigsTable,
  teamEventDreambreakersTable,
  teamEventRosterPlayersTable, teamEventRubberTemplatesTable, teamEventRubbersTable,
  teamsTable, tournamentTable,
} from "@workspace/db";
import {
  GenerateTeamEventCrossoverBody, GenerateTeamEventCrossoverParams, GenerateTeamEventCrossoverResponse, GetTeamEventStateParams,
  GetTeamEventStateResponse, ReplaceTeamEventRosterBody, ReplaceTeamEventRosterParams,
  ReplaceTeamEventRosterResponse, SaveTeamEventRubberLineupBody, SaveTeamEventRubberLineupParams,
  SaveTeamEventRubberLineupResponse, ScoreTeamEventRubberBody, ScoreTeamEventRubberParams,
  ScoreTeamEventRubberResponse, ResetTeamEventRubberScoreParams, ResetTeamEventRubberScoreResponse,
  UpdateTeamEventConfigBody, UpdateTeamEventConfigParams,
  UpdateTeamEventConfigResponse, SaveTeamEventDreambreakerLineupBody,
  SaveTeamEventDreambreakerLineupParams, SaveTeamEventDreambreakerLineupResponse,
  ScoreTeamEventDreambreakerBody, ScoreTeamEventDreambreakerParams, ScoreTeamEventDreambreakerResponse,
} from "@workspace/api-zod";
import { hasRequiredGenders, isKnockoutTieClinched, isValidDreambreakerRotation, pointsForTeamTie, validateRubberGames, type TeamEventMatchType } from "../lib/teamEvent";
import { broadcast } from "../lib/sseBroadcaster";
import { canManageTournament, isAdminUser, requireAuth } from "./tournament";

const router: IRouter = Router();
async function tournamentForTeam(teamId: number) {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) return null;
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, team.groupId));
  if (!group) return null;
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, group.tournamentId));
  return tournament ?? null;
}
async function allowed(tournamentId: number, userId: string): Promise<boolean> {
  const [t] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, tournamentId));
  if (!t) return false;
  return canManageTournament(t, userId, await isAdminUser(userId));
}
async function parentTournament(rubber: typeof teamEventRubbersTable.$inferSelect): Promise<number | null> {
  if (rubber.groupMatchId) {
    const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, rubber.groupMatchId));
    if (!match) return null;
    const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, match.groupId));
    return group?.tournamentId ?? null;
  }
  const [match] = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, rubber.knockoutMatchId!));
  return match?.tournamentId ?? null;
}
async function ensureThirdPlaceMatch(tournamentId: number) {
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, tournamentId));
  if (!tournament?.thirdPlacePlayoffEnabled) return null;
  const semifinals = await db.select().from(knockoutMatchesTable).where(and(
    eq(knockoutMatchesTable.tournamentId, tournamentId),
    eq(knockoutMatchesTable.round, "semi"),
  ));
  if (semifinals.length < 2) return null;

  let [thirdPlace] = await db.select().from(knockoutMatchesTable).where(and(
    eq(knockoutMatchesTable.tournamentId, tournamentId),
    eq(knockoutMatchesTable.round, "third_place"),
    eq(knockoutMatchesTable.matchNumber, 1),
  ));
  if (!thirdPlace) {
    [thirdPlace] = await db.insert(knockoutMatchesTable).values({
      tournamentId,
      round: "third_place",
      matchNumber: 1,
    }).returning();
    const templates = await db.select().from(teamEventRubberTemplatesTable).where(and(
      eq(teamEventRubberTemplatesTable.tournamentId, tournamentId),
      eq(teamEventRubberTemplatesTable.stage, "knockout"),
    ));
    if (templates.length) await db.insert(teamEventRubbersTable).values(templates.map((template) => ({
      knockoutMatchId: thirdPlace.id,
      order: template.order,
      matchType: template.matchType,
      targetPoints: template.targetPoints,
      bestOf: template.bestOf,
      disallowSameMaleFromPreviousMixed: template.disallowSameMaleFromPreviousMixed,
    })));
  }

  for (const semifinal of semifinals) {
    if (!semifinal.played || !semifinal.winnerId || !semifinal.homeTeamId || !semifinal.awayTeamId) continue;
    const loserId = semifinal.winnerId === semifinal.homeTeamId
      ? semifinal.awayTeamId
      : semifinal.homeTeamId;
    await db.update(knockoutMatchesTable)
      .set(semifinal.matchNumber === 1 ? { homeTeamId: loserId } : { awayTeamId: loserId })
      .where(eq(knockoutMatchesTable.id, thirdPlace.id));
  }
  return thirdPlace;
}
async function placeSemifinalTeams(
  tournamentId: number,
  matchNumber: number,
  winnerId: number,
  loserId: number,
) {
  await db.update(knockoutMatchesTable)
    .set(matchNumber === 1 ? { homeTeamId: winnerId } : { awayTeamId: winnerId })
    .where(and(
      eq(knockoutMatchesTable.tournamentId, tournamentId),
      eq(knockoutMatchesTable.round, "final"),
      eq(knockoutMatchesTable.matchNumber, 1),
    ));

  const thirdPlace = await ensureThirdPlaceMatch(tournamentId);
  if (!thirdPlace) return;
  await db.update(knockoutMatchesTable)
    .set(matchNumber === 1 ? { homeTeamId: loserId } : { awayTeamId: loserId })
    .where(eq(knockoutMatchesTable.id, thirdPlace.id));

}
async function state(tournamentId: number) {
  await ensureThirdPlaceMatch(tournamentId);
  const groups = await db.select().from(groupsTable).where(eq(groupsTable.tournamentId, tournamentId)).orderBy(groupsTable.groupNumber);
  const groupIds = groups.map((g) => g.id);
  const teams = groupIds.length ? await db.select().from(teamsTable).where(inArray(teamsTable.groupId, groupIds)) : [];
  const matchRows = groupIds.length ? await db.select().from(matchesTable).where(inArray(matchesTable.groupId, groupIds)) : [];
  const knockouts = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, tournamentId));
  const parentIds = new Set([...matchRows.map((m) => m.id), ...knockouts.map((m) => m.id)]);
  const selected = parentIds.size ? await db.select().from(teamEventRubbersTable).where(or(
    matchRows.length ? inArray(teamEventRubbersTable.groupMatchId, matchRows.map((match) => match.id)) : undefined,
    knockouts.length ? inArray(teamEventRubbersTable.knockoutMatchId, knockouts.map((match) => match.id)) : undefined,
  )) : [];
  const rosters = teams.length ? await db.select().from(teamEventRosterPlayersTable).where(inArray(teamEventRosterPlayersTable.teamId, teams.map((team) => team.id))) : [];
  const rosterMap: Record<string, typeof rosters> = {};
  for (const player of rosters.filter((p) => teams.some((t) => t.id === p.teamId))) (rosterMap[player.teamId] ??= []).push(player);
  const [config] = await db.select().from(teamEventConfigsTable).where(eq(teamEventConfigsTable.tournamentId, tournamentId));
  const dreambreakers = knockouts.length
    ? await db.select().from(teamEventDreambreakersTable).where(inArray(teamEventDreambreakersTable.knockoutMatchId, knockouts.map((match) => match.id)))
    : [];
  const templates = await db.select().from(teamEventRubberTemplatesTable).where(eq(teamEventRubberTemplatesTable.tournamentId, tournamentId));
  const standings = groups.flatMap((group) => teams.filter((t) => t.groupId === group.id).map((team) => {
    const teamMatches = matchRows.filter((m) => m.homeTeamId === team.id || m.awayTeamId === team.id);
    const rows = teamMatches.filter((m) => m.played);
    const completedRubbers = selected.filter((rubber) => {
      const match = teamMatches.find((m) => m.id === rubber.groupMatchId);
      return match && rubber.played && rubber.homeScore != null && rubber.awayScore != null;
    });
    let points = 0, wins = 0, draws = 0, losses = 0;
    let gf = 0, ga = 0, scoreFor = 0, scoreAgainst = 0;
    for (const rubber of completedRubbers) {
      const match = teamMatches.find((m) => m.id === rubber.groupMatchId)!;
      const home = match.homeTeamId === team.id;
      const teamScore = home ? rubber.homeScore! : rubber.awayScore!;
      const opponentScore = home ? rubber.awayScore! : rubber.homeScore!;
      if (teamScore > opponentScore) gf++;
      else ga++;
      for (const game of rubber.games) {
        scoreFor += home ? game.homeScore : game.awayScore;
        scoreAgainst += home ? game.awayScore : game.homeScore;
      }
    }
    for (const m of rows) {
      const home = m.homeTeamId === team.id;
      const tieRubbers = selected.filter((r) => r.groupMatchId === m.id && r.played && r.homeScore != null && r.awayScore != null);
      const rubberWon = tieRubbers.filter((r) => home ? r.homeScore! > r.awayScore! : r.awayScore! > r.homeScore!).length;
      const rubberLost = tieRubbers.length - rubberWon;
      points += pointsForTeamTie(rubberWon, rubberLost);
      if (rubberWon > rubberLost) { wins++; }
      else if (rubberWon < rubberLost) losses++;
      else draws++;
    }
    return {
      groupId: group.id,
      groupName: group.name,
      teamId: team.id,
      teamName: team.name,
      played: rows.length,
      wins,
      draws,
      losses,
      goalsFor: gf,
      goalsAgainst: ga,
      points,
      scoreFor,
      scoreAgainst,
      rallyDifference: scoreFor - scoreAgainst,
    };
  })).sort((a, b) => b.points - a.points
    || b.wins - a.wins
    || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)
    || b.rallyDifference - a.rallyDifference);
  return { tournamentId, config: config ? { minMen: config.minMen, minWomen: config.minWomen, dreambreakerEnabled: config.dreambreakerEnabled } : null, templates, rosters: rosterMap, rubbers: selected, dreambreakers, standings };
}

router.get("/tournaments/:id/team-event", async (req, res): Promise<void> => {
  const p = GetTeamEventStateParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [t] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, p.data.id));
  if (!t || t.format !== "team_event") { res.status(404).json({ error: "Team event not found" }); return; }
  res.json(GetTeamEventStateResponse.parse(await state(t.id)));
});
router.put("/tournaments/:id/team-event", requireAuth, async (req, res): Promise<void> => {
  const p = UpdateTeamEventConfigParams.safeParse(req.params), body = UpdateTeamEventConfigBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  if (!await allowed(p.data.id, (req as Request & { userId: string }).userId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, p.data.id));
  if (!tournament || tournament.format !== "team_event") { res.status(409).json({ error: "Tournament is not a Team Event" }); return; }
  if (body.data.minMen + body.data.minWomen < 2) { res.status(400).json({ error: "Minimum roster must contain at least two players" }); return; }
  for (const stage of ["group", "knockout"] as const) {
    const orders = body.data.templates.filter((template) => template.stage === stage).map((template) => template.order).sort((a, b) => a - b);
    if (orders.length === 0 || orders.some((order, index) => order !== index + 1)) {
      res.status(400).json({ error: `${stage} templates must start at 1 and have contiguous ordering` }); return;
    }
  }
  if (body.data.templates.some((template) => template.disallowSameMaleFromPreviousMixed && template.matchType !== "mixed_doubles")) {
    res.status(400).json({ error: "The mixed-repeat restriction is only valid for mixed doubles" }); return;
  }
  const knockoutCount = body.data.templates.filter((template) => template.stage === "knockout").length;
  if (!body.data.dreambreakerEnabled && knockoutCount % 2 === 0) {
    res.status(400).json({ error: "An even knockout template requires the Dreambreaker option" }); return;
  }
  if (body.data.dreambreakerEnabled && (body.data.minMen < 2 || body.data.minWomen < 2)) {
    res.status(400).json({ error: "Dreambreaker requires roster minimums of at least two men and two women" }); return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(teamEventRubberTemplatesTable).where(eq(teamEventRubberTemplatesTable.tournamentId, p.data.id));
    await tx.insert(teamEventConfigsTable).values({ tournamentId: p.data.id, minMen: body.data.minMen, minWomen: body.data.minWomen, dreambreakerEnabled: body.data.dreambreakerEnabled }).onConflictDoUpdate({ target: teamEventConfigsTable.tournamentId, set: { minMen: body.data.minMen, minWomen: body.data.minWomen, dreambreakerEnabled: body.data.dreambreakerEnabled } });
    await tx.insert(teamEventRubberTemplatesTable).values(body.data.templates.map((x) => ({ ...x, tournamentId: p.data.id, disallowSameMaleFromPreviousMixed: x.disallowSameMaleFromPreviousMixed ?? false })));
  });
  broadcast(p.data.id); res.json(UpdateTeamEventConfigResponse.parse(await state(p.data.id)));
});
router.put("/teams/:id/roster", requireAuth, async (req, res): Promise<void> => {
  const p = ReplaceTeamEventRosterParams.safeParse(req.params), body = ReplaceTeamEventRosterBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const tournament = await tournamentForTeam(p.data.id);
  if (!tournament) { res.status(404).json({ error: "Team not found" }); return; }
  if (!await allowed(tournament.id, (req as Request & { userId: string }).userId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const [config] = await db.select().from(teamEventConfigsTable).where(eq(teamEventConfigsTable.tournamentId, tournament.id));
  if (body.data.players.some((player) => !player.name.trim())) { res.status(400).json({ error: "Every roster member requires a name" }); return; }
  const men = body.data.players.filter((x) => x.gender === "male").length;
  if (!config || men < config.minMen || body.data.players.length - men < config.minWomen) { res.status(400).json({ error: "Roster does not meet minimum gender requirements" }); return; }
  const players = await db.transaction(async (tx) => {
    await tx.delete(teamEventRosterPlayersTable).where(eq(teamEventRosterPlayersTable.teamId, p.data.id));
    return body.data.players.length ? tx.insert(teamEventRosterPlayersTable).values(body.data.players.map((x) => ({ ...x, name: x.name.trim(), teamId: p.data.id }))).returning() : [];
  });
  broadcast(tournament.id); res.json(ReplaceTeamEventRosterResponse.parse(players));
});
router.put("/team-event-rubbers/:id/lineup", requireAuth, async (req, res): Promise<void> => {
  const p = SaveTeamEventRubberLineupParams.safeParse(req.params), body = SaveTeamEventRubberLineupBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [rubber] = await db.select().from(teamEventRubbersTable).where(eq(teamEventRubbersTable.id, p.data.id));
  if (!rubber) { res.status(404).json({ error: "Rubber not found" }); return; }
  const tournamentId = await parentTournament(rubber);
  if (!tournamentId || !await allowed(tournamentId, (req as Request & { userId: string }).userId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const parent = rubber.groupMatchId
    ? (await db.select().from(matchesTable).where(eq(matchesTable.id, rubber.groupMatchId)))[0]
    : (await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, rubber.knockoutMatchId!)))[0];
  if (!parent || parent.homeTeamId == null || parent.awayTeamId == null) { res.status(409).json({ error: "Parent tie has no teams" }); return; }
  const ids = [...body.data.homePlayerIds, ...body.data.awayPlayerIds];
  if (new Set(ids).size !== ids.length) { res.status(400).json({ error: "A player cannot appear twice in one rubber" }); return; }
  const players = ids.length ? await db.select().from(teamEventRosterPlayersTable).where(inArray(teamEventRosterPlayersTable.id, ids)) : [];
  const home = players.filter((x) => body.data.homePlayerIds.includes(x.id));
  const away = players.filter((x) => body.data.awayPlayerIds.includes(x.id));
  if (players.length !== ids.length || home.some((x) => x.teamId !== parent.homeTeamId) || away.some((x) => x.teamId !== parent.awayTeamId)
    || !hasRequiredGenders(rubber.matchType as TeamEventMatchType, home) || !hasRequiredGenders(rubber.matchType as TeamEventMatchType, away)) {
    res.status(400).json({ error: "Lineup player count, team, or gender is invalid" }); return;
  }
  if (rubber.disallowSameMaleFromPreviousMixed && rubber.matchType === "mixed_doubles") {
    const previous = await db.select().from(teamEventRubbersTable).where(rubber.groupMatchId ? eq(teamEventRubbersTable.groupMatchId, rubber.groupMatchId) : eq(teamEventRubbersTable.knockoutMatchId, rubber.knockoutMatchId!));
    const prior = previous.filter((x) => x.order < rubber.order && x.matchType === "mixed_doubles").sort((a, b) => b.order - a.order)[0];
    if (prior) {
      const previousIds = [...prior.homePlayerIds, ...prior.awayPlayerIds];
      const previousPlayers = previousIds.length ? await db.select().from(teamEventRosterPlayersTable).where(inArray(teamEventRosterPlayersTable.id, previousIds)) : [];
      const priorHomeMen = new Set(previousPlayers.filter((player) => player.gender === "male" && prior.homePlayerIds.includes(player.id)).map((player) => player.id));
      const priorAwayMen = new Set(previousPlayers.filter((player) => player.gender === "male" && prior.awayPlayerIds.includes(player.id)).map((player) => player.id));
      if (home.some((player) => player.gender === "male" && priorHomeMen.has(player.id))
        || away.some((player) => player.gender === "male" && priorAwayMen.has(player.id))) {
        res.status(400).json({ error: "Male player may not repeat from the immediately previous mixed rubber" }); return;
      }
    }
  }
  const [updated] = await db.update(teamEventRubbersTable).set(body.data).where(eq(teamEventRubbersTable.id, rubber.id)).returning();
  broadcast(tournamentId); res.json(SaveTeamEventRubberLineupResponse.parse(updated));
});
router.put("/team-event-rubbers/:id/score", requireAuth, async (req, res): Promise<void> => {
  const p = ScoreTeamEventRubberParams.safeParse(req.params), body = ScoreTeamEventRubberBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [rubber] = await db.select().from(teamEventRubbersTable).where(eq(teamEventRubbersTable.id, p.data.id));
  if (!rubber) { res.status(404).json({ error: "Rubber not found" }); return; }
  const tournamentId = await parentTournament(rubber);
  if (!tournamentId || !await allowed(tournamentId, (req as Request & { userId: string }).userId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const series = validateRubberGames(rubber.targetPoints, rubber.bestOf, body.data.games);
  if (!series) { res.status(400).json({ error: "Games are invalid or do not complete this rubber format" }); return; }
  const parent = rubber.groupMatchId
    ? (await db.select().from(matchesTable).where(eq(matchesTable.id, rubber.groupMatchId)))[0]
    : (await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, rubber.knockoutMatchId!)))[0];
  const lineupIds = [...rubber.homePlayerIds, ...rubber.awayPlayerIds];
  const lineupPlayers = lineupIds.length ? await db.select().from(teamEventRosterPlayersTable).where(inArray(teamEventRosterPlayersTable.id, lineupIds)) : [];
  const homeLineup = lineupPlayers.filter((player) => rubber.homePlayerIds.includes(player.id));
  const awayLineup = lineupPlayers.filter((player) => rubber.awayPlayerIds.includes(player.id));
  if (!parent || parent.homeTeamId == null || parent.awayTeamId == null || new Set(lineupIds).size !== lineupIds.length
    || lineupPlayers.length !== lineupIds.length || homeLineup.some((player) => player.teamId !== parent.homeTeamId)
    || awayLineup.some((player) => player.teamId !== parent.awayTeamId)
    || !hasRequiredGenders(rubber.matchType as TeamEventMatchType, homeLineup)
    || !hasRequiredGenders(rubber.matchType as TeamEventMatchType, awayLineup)) {
    res.status(409).json({ error: "A complete valid lineup is required before scoring" }); return;
  }
  const [updated] = await db.update(teamEventRubbersTable).set({ games: body.data.games, homeScore: series.homeWins, awayScore: series.awayWins, played: true }).where(eq(teamEventRubbersTable.id, rubber.id)).returning();
  const siblings = await db.select().from(teamEventRubbersTable).where(rubber.groupMatchId ? eq(teamEventRubbersTable.groupMatchId, rubber.groupMatchId) : eq(teamEventRubbersTable.knockoutMatchId, rubber.knockoutMatchId!));
  const scored = siblings.map((x) => x.id === rubber.id ? updated : x);
  const completed = scored.filter((x) => x.played);
  const homeWins = completed.filter((x) => x.homeScore! > x.awayScore!).length;
  const awayWins = completed.length - homeWins;
  const allPlayed = completed.length === scored.length;
  if (rubber.groupMatchId) {
    if (allPlayed) await db.update(matchesTable).set({ homeScore: homeWins, awayScore: awayWins, played: true }).where(eq(matchesTable.id, rubber.groupMatchId));
  } else {
    const [tie] = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, rubber.knockoutMatchId!));
    const [config] = tie ? await db.select().from(teamEventConfigsTable).where(eq(teamEventConfigsTable.tournamentId, tie.tournamentId)) : [];
    const clinched = isKnockoutTieClinched(homeWins, awayWins, scored.length - completed.length);
    if (allPlayed && homeWins === awayWins && config?.dreambreakerEnabled) {
      await db.update(knockoutMatchesTable).set({ homeScore: homeWins, awayScore: awayWins, played: false, winnerId: null }).where(eq(knockoutMatchesTable.id, rubber.knockoutMatchId!));
      await db.insert(teamEventDreambreakersTable).values({ knockoutMatchId: rubber.knockoutMatchId! }).onConflictDoNothing();
    } else if (clinched || (allPlayed && homeWins !== awayWins)) {
      const winnerId = homeWins > awayWins ? tie?.homeTeamId : tie?.awayTeamId;
      await db.update(knockoutMatchesTable).set({ homeScore: homeWins, awayScore: awayWins, played: true, winnerId }).where(eq(knockoutMatchesTable.id, rubber.knockoutMatchId!));
      if (tie?.round === "semi" && winnerId && tie.homeTeamId && tie.awayTeamId) {
        const loserId = winnerId === tie.homeTeamId ? tie.awayTeamId : tie.homeTeamId;
        await placeSemifinalTeams(tie.tournamentId, tie.matchNumber, winnerId, loserId);
      }
    } else {
      await db.update(knockoutMatchesTable).set({ homeScore: homeWins, awayScore: awayWins, played: false, winnerId: null }).where(eq(knockoutMatchesTable.id, rubber.knockoutMatchId!));
    }
  }
  broadcast(tournamentId); res.json(ScoreTeamEventRubberResponse.parse(updated));
});
router.delete("/team-event-rubbers/:id/score", requireAuth, async (req, res): Promise<void> => {
  const p = ResetTeamEventRubberScoreParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [rubber] = await db.select().from(teamEventRubbersTable).where(eq(teamEventRubbersTable.id, p.data.id));
  if (!rubber) { res.status(404).json({ error: "Rubber not found" }); return; }
  const tournamentId = await parentTournament(rubber);
  if (!tournamentId || !await allowed(tournamentId, (req as Request & { userId: string }).userId)) { res.status(403).json({ error: "Forbidden" }); return; }

  const [updated] = await db.update(teamEventRubbersTable)
    .set({ games: [], homeScore: null, awayScore: null, played: false })
    .where(eq(teamEventRubbersTable.id, rubber.id))
    .returning();
  const siblings = await db.select().from(teamEventRubbersTable).where(
    rubber.groupMatchId
      ? eq(teamEventRubbersTable.groupMatchId, rubber.groupMatchId)
      : eq(teamEventRubbersTable.knockoutMatchId, rubber.knockoutMatchId!),
  );
  const completed = siblings.filter((item) => item.played);
  const homeWins = completed.filter((item) => item.homeScore! > item.awayScore!).length;
  const awayWins = completed.length - homeWins;

  if (rubber.groupMatchId) {
    await db.update(matchesTable)
      .set({ homeScore: homeWins, awayScore: awayWins, played: false })
      .where(eq(matchesTable.id, rubber.groupMatchId));
  } else {
    const [tie] = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, rubber.knockoutMatchId!));
    const clinched = isKnockoutTieClinched(homeWins, awayWins, siblings.length - completed.length);
    const winnerId = clinched ? (homeWins > awayWins ? tie?.homeTeamId : tie?.awayTeamId) : null;
    await db.update(knockoutMatchesTable)
      .set({ homeScore: homeWins, awayScore: awayWins, played: clinched, winnerId })
      .where(eq(knockoutMatchesTable.id, rubber.knockoutMatchId!));
    await db.delete(teamEventDreambreakersTable).where(eq(teamEventDreambreakersTable.knockoutMatchId, rubber.knockoutMatchId!));
    if (clinched && tie?.round === "semi" && winnerId && tie.homeTeamId && tie.awayTeamId) {
      const loserId = winnerId === tie.homeTeamId ? tie.awayTeamId : tie.homeTeamId;
      await placeSemifinalTeams(tie.tournamentId, tie.matchNumber, winnerId, loserId);
    }
  }

  broadcast(tournamentId);
  res.json(ResetTeamEventRubberScoreResponse.parse(updated));
});
router.post("/tournaments/:id/team-event/crossover", requireAuth, async (req, res): Promise<void> => {
  const p = GenerateTeamEventCrossoverParams.safeParse(req.params), body = GenerateTeamEventCrossoverBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  if (!await allowed(p.data.id, (req as Request & { userId: string }).userId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const current = await state(p.data.id);
  const groupRows = await db.select()
    .from(groupsTable)
    .where(eq(groupsTable.tournamentId, p.data.id))
    .orderBy(groupsTable.groupNumber);
  const groups = groupRows.map((group) => group.id);
  if (groups.length !== 2) { res.status(409).json({ error: "Two groups are required" }); return; }
  const a = current.standings.filter((x) => x.groupId === groups[0]), b = current.standings.filter((x) => x.groupId === groups[1]);
  if (a.length < 2 || b.length < 2) { res.status(409).json({ error: "Each group requires two ranked teams" }); return; }
  const chosen = [body.data.a1TeamId, body.data.a2TeamId, body.data.b1TeamId, body.data.b2TeamId];
  if (new Set(chosen).size !== 4
    || !a.some((team) => team.teamId === body.data.a1TeamId)
    || !a.some((team) => team.teamId === body.data.a2TeamId)
    || !b.some((team) => team.teamId === body.data.b1TeamId)
    || !b.some((team) => team.teamId === body.data.b2TeamId)) {
    res.status(400).json({ error: "Choose two distinct teams from each group" }); return;
  }
  const existingBracket = await db.select({ id: knockoutMatchesTable.id }).from(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, p.data.id));
  if (existingBracket.length) { res.status(409).json({ error: "A crossover bracket already exists" }); return; }
  const knockoutTemplates = await db.select().from(teamEventRubberTemplatesTable).where(and(eq(teamEventRubberTemplatesTable.tournamentId, p.data.id), eq(teamEventRubberTemplatesTable.stage, "knockout")));
  const config = current.config;
  if (knockoutTemplates.length % 2 === 0 && !config?.dreambreakerEnabled) { res.status(400).json({ error: "Even knockout ties require Dreambreaker" }); return; }
  const bracketMatches = [
    { tournamentId: p.data.id, round: "semi", matchNumber: 1, homeTeamId: body.data.a1TeamId, awayTeamId: body.data.b2TeamId },
    { tournamentId: p.data.id, round: "semi", matchNumber: 2, homeTeamId: body.data.b1TeamId, awayTeamId: body.data.a2TeamId },
    { tournamentId: p.data.id, round: "final", matchNumber: 1 },
  ];
  if ((await db.select().from(tournamentTable).where(eq(tournamentTable.id, p.data.id)))[0]?.thirdPlacePlayoffEnabled) {
    bracketMatches.splice(2, 0, { tournamentId: p.data.id, round: "third_place", matchNumber: 1 });
  }
  const created = await db.insert(knockoutMatchesTable).values(bracketMatches).returning();
  const templates = knockoutTemplates;
  if (templates.length) await db.insert(teamEventRubbersTable).values(created.flatMap((tie) => templates.map((template) => ({
    knockoutMatchId: tie.id, order: template.order, matchType: template.matchType, targetPoints: template.targetPoints,
    bestOf: template.bestOf, disallowSameMaleFromPreviousMixed: template.disallowSameMaleFromPreviousMixed,
  }))));
  broadcast(p.data.id); res.status(201).json(GenerateTeamEventCrossoverResponse.parse(created));
});

router.put("/knockout-matches/:id/dreambreaker/lineup", requireAuth, async (req, res): Promise<void> => {
  const p = SaveTeamEventDreambreakerLineupParams.safeParse(req.params), body = SaveTeamEventDreambreakerLineupBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [tie] = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, p.data.id));
  if (!tie || !await allowed(tie.tournamentId, (req as Request & { userId: string }).userId)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tie.homeTeamId == null || tie.awayTeamId == null || ![tie.homeTeamId, tie.awayTeamId].includes(body.data.teamId)) { res.status(409).json({ error: "Dreambreaker teams are not ready" }); return; }
  const [dreambreaker] = await db.select().from(teamEventDreambreakersTable).where(eq(teamEventDreambreakersTable.knockoutMatchId, tie.id));
  if (!dreambreaker) { res.status(409).json({ error: "Dreambreaker is only available after regulation rubbers finish tied" }); return; }
  if (dreambreaker.played || dreambreaker.homeScore != null || dreambreaker.awayScore != null) { res.status(409).json({ error: "Dreambreaker rotations are locked after scoring starts" }); return; }
  if (new Set(body.data.playerIds).size !== 4) { res.status(400).json({ error: "Choose four different players" }); return; }
  const players = await db.select().from(teamEventRosterPlayersTable).where(inArray(teamEventRosterPlayersTable.id, body.data.playerIds));
  if (players.some((player) => player.teamId !== body.data.teamId) || !isValidDreambreakerRotation(players)) {
    res.status(400).json({ error: "Dreambreaker rotation requires two named men and two named women from the team roster" }); return;
  }
  const isHome = body.data.teamId === tie.homeTeamId;
  const firstIds = dreambreaker.firstTeamId === tie.homeTeamId ? dreambreaker.homePlayerIds : dreambreaker.awayPlayerIds;
  if (dreambreaker.firstTeamId && dreambreaker.firstTeamId !== body.data.teamId && firstIds.length !== 4) {
    res.status(409).json({ error: "The first team must submit its rotation before the counter-lineup" }); return;
  }
  const [updated] = await db.update(teamEventDreambreakersTable).set({
    firstTeamId: dreambreaker.firstTeamId ?? body.data.teamId,
    ...(isHome ? { homePlayerIds: body.data.playerIds } : { awayPlayerIds: body.data.playerIds }),
  }).where(eq(teamEventDreambreakersTable.id, dreambreaker.id)).returning();
  broadcast(tie.tournamentId); res.json(SaveTeamEventDreambreakerLineupResponse.parse(updated));
});

router.put("/knockout-matches/:id/dreambreaker/score", requireAuth, async (req, res): Promise<void> => {
  const p = ScoreTeamEventDreambreakerParams.safeParse(req.params), body = ScoreTeamEventDreambreakerBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [tie] = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, p.data.id));
  if (!tie || !await allowed(tie.tournamentId, (req as Request & { userId: string }).userId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const [dreambreaker] = await db.select().from(teamEventDreambreakersTable).where(eq(teamEventDreambreakersTable.knockoutMatchId, tie.id));
  if (!dreambreaker || dreambreaker.homePlayerIds.length !== 4 || dreambreaker.awayPlayerIds.length !== 4) { res.status(409).json({ error: "Both Dreambreaker rotations are required before scoring" }); return; }
  const complete = !!validateRubberGames(21, 1, [body.data]);
  const [updated] = await db.update(teamEventDreambreakersTable).set({ ...body.data, played: complete }).where(eq(teamEventDreambreakersTable.id, dreambreaker.id)).returning();
  if (complete) {
    const winnerId = body.data.homeScore > body.data.awayScore ? tie.homeTeamId : tie.awayTeamId;
    await db.update(knockoutMatchesTable).set({ played: true, winnerId }).where(eq(knockoutMatchesTable.id, tie.id));
    if (tie.round === "semi" && winnerId && tie.homeTeamId && tie.awayTeamId) {
      const loserId = winnerId === tie.homeTeamId ? tie.awayTeamId : tie.homeTeamId;
      await placeSemifinalTeams(tie.tournamentId, tie.matchNumber, winnerId, loserId);
    }
  }
  broadcast(tie.tournamentId); res.json(ScoreTeamEventDreambreakerResponse.parse(updated));
});
export default router;