import { Router, type IRouter, type Request } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, breakoutKnockoutsTable, groupsTable, teamsTable, tournamentTable, knockoutMatchesTable } from "@workspace/db";
import {
  GetBreakoutKnockoutsParams, GetBreakoutKnockoutsResponse,
  ConfigureBreakoutKnockoutsParams, ConfigureBreakoutKnockoutsBody, ConfigureBreakoutKnockoutsResponse,
  GenerateBreakoutKnockoutsParams, GenerateBreakoutKnockoutsResponse,
  GenerateBreakoutKnockoutsBody,
  ResetBreakoutKnockoutsParams, ResetBreakoutKnockoutsResponse,
  UpdateBreakoutKnockoutScoreParams, UpdateBreakoutKnockoutScoreBody, UpdateBreakoutKnockoutScoreResponse,
  UpdateGroupNameParams, UpdateGroupNameBody, UpdateGroupNameResponse,
} from "@workspace/api-zod";
import { canManageTournament, isAdminUser, requireAuth, getSortedQualifiers } from "./tournament";
import { broadcast } from "../lib/sseBroadcaster";
import { computeBreakoutBracket, validBreakoutGroups } from "../lib/breakoutBracket";
import { getBreakoutQualification } from "../lib/breakoutQualification";

const router: IRouter = Router();

class ActionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function validIds(params: Record<string, number>) {
  return Object.values(params).every((value) => Number.isSafeInteger(value) && value > 0);
}

async function getState(id: number) {
  const rows = await db.select().from(breakoutKnockoutsTable)
    .where(eq(breakoutKnockoutsTable.tournamentId, id)).orderBy(breakoutKnockoutsTable.position);
  const teamIds = [...new Set(rows.flatMap((row) => row.seeds))];
  const teams = teamIds.length ? await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds)) : [];
  const names = new Map(teams.map((team) => [team.id, team.name]));
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, id));
  const groups = rows.length === 2 ? await db.select().from(groupsTable).where(eq(groupsTable.tournamentId, id)).orderBy(groupsTable.groupNumber) : [];
  const qualification = tournament && rows.length === 2
    ? await getBreakoutQualification(tournament, groups)
    : { qualifiers: [], ready: false, message: null };
  // Once generated, membership and seed order are frozen even after a manual override
  // or subsequent changes to qualification settings/group scores.
  const rankedTeams = tournament && rows.some((row) => row.seeds.length > 0)
    ? await getSortedQualifiers({ ...tournament, qualifiersPerGroup: Math.max(tournament.teamsPerGroup, teams.length, 1), wildcardQualifiers: 0 })
    : [];
  const positions = new Map(rankedTeams.map((qualifier) => [qualifier.teamId, qualifier.position]));
  const seededTeams = new Map(teams.map((team) => [team.id, team]));
  const shortBracket = rows.find((row) => qualification.qualifiers.filter((qualifier) => row.groupIds.includes(qualifier.groupId)).length < 2);
  const oversizedBracket = rows.find((row) => qualification.qualifiers.filter((qualifier) => row.groupIds.includes(qualifier.groupId)).length > 64);
  const knockoutFormat = tournament?.knockoutFormat === "top6" ? "top6" as const : "single" as const;
  const topSixMismatch = knockoutFormat === "top6"
    ? rows.find((row) => qualification.qualifiers.filter((qualifier) => row.groupIds.includes(qualifier.groupId)).length !== 6)
    : undefined;
  return {
    enabled: rows.length === 2,
    knockoutFormat,
    qualificationReady: qualification.ready && !shortBracket && !oversizedBracket && !topSixMismatch,
    qualificationMessage: qualification.message ?? (topSixMismatch ? `${topSixMismatch.name} needs exactly six qualifying teams for Top 6 Playoff. Adjust selected groups or qualification settings.`
      : shortBracket ? `${shortBracket.name} needs at least two qualifying teams. Adjust selected groups or qualification settings.`
      : oversizedBracket ? `${oversizedBracket.name} exceeds the maximum of 64 qualifying teams.` : null),
    brackets: rows.map((row) => {
      const computed = computeBreakoutBracket(row.seeds, row.scores);
      return {
        id: row.id, name: row.name, groupIds: row.groupIds,
        qualifiers: row.seeds.length
          ? row.seeds.map((teamId) => ({
              teamId, teamName: names.get(teamId) ?? "Removed team",
              groupId: seededTeams.get(teamId)?.groupId ?? row.groupIds[0],
              position: positions.get(teamId) ?? tournament?.qualifiersPerGroup ?? 0,
            }))
          : qualification.qualifiers.filter((qualifier) => row.groupIds.includes(qualifier.groupId)),
        matches: computed.matches.map((match) => ({
          ...match, homeTeamName: match.homeTeamId === null ? null : names.get(match.homeTeamId) ?? "Removed team",
          awayTeamName: match.awayTeamId === null ? null : names.get(match.awayTeamId) ?? "Removed team",
        })),
        winnerTeamId: computed.winnerTeamId,
        winnerTeamName: computed.winnerTeamId === null ? null : names.get(computed.winnerTeamId) ?? "Removed team",
      };
    }),
  };
}

/** Tournament row lock serializes configuration, generation, reset and score changes. */
async function manage<T>(id: number, req: Request, action: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], tournament: typeof tournamentTable.$inferSelect) => Promise<T>) {
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, id));
  if (!tournament) throw new ActionError(404, "Tournament not found");
  const userId = (req as Request & { userId: string }).userId;
  if (!await canManageTournament(tournament, userId, await isAdminUser(userId))) throw new ActionError(403, "Forbidden");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from tournament where id = ${id} for update`);
    const [current] = await tx.select().from(tournamentTable).where(eq(tournamentTable.id, id));
    if (!current) throw new ActionError(404, "Tournament not found");
    if (current.status === "completed") throw new ActionError(409, "Reopen the tournament before making changes");
    if (!["round_robin", "group_knockout"].includes(current.format)) {
      throw new ActionError(409, "Two breakout knockouts are available for normal group-based tournaments");
    }
    return action(tx, current);
  });
}

router.get("/tournaments/:id/breakout-knockouts", async (req, res): Promise<void> => {
  const params = GetBreakoutKnockoutsParams.safeParse(req.params);
  if (!params.success || !validIds(params.data)) { res.status(400).json({ error: "Invalid tournament" }); return; }
  const [tournament] = await db.select({ id: tournamentTable.id }).from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  res.json(GetBreakoutKnockoutsResponse.parse(await getState(tournament.id)));
});

router.put("/tournaments/:id/breakout-knockouts", requireAuth, async (req, res): Promise<void> => {
  const params = ConfigureBreakoutKnockoutsParams.safeParse(req.params);
  const body = ConfigureBreakoutKnockoutsBody.safeParse(req.body);
  if (!params.success || !validIds(params.data) || !body.success) { res.status(400).json({ error: "Invalid knockout configuration" }); return; }
  const id = params.data.id;
  try {
    await manage(id, req, async (tx, tournament) => {
      const old = await tx.select().from(breakoutKnockoutsTable).where(eq(breakoutKnockoutsTable.tournamentId, id));
      if (old.some((row) => row.seeds.length > 0)) throw new ActionError(409, "Reset both breakout brackets before changing their configuration");
      if (!body.data.enabled) {
        await tx.delete(breakoutKnockoutsTable).where(eq(breakoutKnockoutsTable.tournamentId, id));
        return;
      }
      const [legacy] = await tx.select({ id: knockoutMatchesTable.id }).from(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, id));
      if (legacy) throw new ActionError(409, "An existing knockout bracket must be reset before enabling two breakout brackets");
      const groups = await tx.select().from(groupsTable).where(eq(groupsTable.tournamentId, id));
      if (!validBreakoutGroups(body.data.brackets, new Set(groups.map((group) => group.id)))) {
        throw new ActionError(400, "Select groups for each of exactly two brackets. A group can belong to only one bracket and must be from this tournament.");
      }
      const names = body.data.brackets.map((bracket) => bracket.name.trim());
      if (names.some((name) => !name)) throw new ActionError(400, "Both brackets need a name");
      if (names[0].toLowerCase() === names[1].toLowerCase()) throw new ActionError(400, "Give the two brackets different names");
      if (tournament.qualifiersPerGroup === null) {
        await tx.update(tournamentTable).set({ qualifiersPerGroup: Math.min(2, tournament.teamsPerGroup) }).where(eq(tournamentTable.id, id));
      }
      await tx.delete(breakoutKnockoutsTable).where(eq(breakoutKnockoutsTable.tournamentId, id));
      await tx.insert(breakoutKnockoutsTable).values(body.data.brackets.map((bracket, position) => ({
        tournamentId: id, position, name: names[position], groupIds: bracket.groupIds,
      })));
    });
    broadcast(id);
    res.json(ConfigureBreakoutKnockoutsResponse.parse(await getState(id)));
  } catch (error) {
    if (error instanceof ActionError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.post("/tournaments/:id/breakout-knockouts/generate", requireAuth, async (req, res): Promise<void> => {
  const params = GenerateBreakoutKnockoutsParams.safeParse(req.params);
  const body = GenerateBreakoutKnockoutsBody.safeParse(req.body ?? {});
  if (!params.success || !validIds(params.data) || !body.success) { res.status(400).json({ error: "Invalid tournament or seeding" }); return; }
  const id = params.data.id;
  try {
    await manage(id, req, async (tx, tournament) => {
      const rows = await tx.select().from(breakoutKnockoutsTable).where(eq(breakoutKnockoutsTable.tournamentId, id)).orderBy(breakoutKnockoutsTable.position);
      const groups = await tx.select().from(groupsTable).where(eq(groupsTable.tournamentId, id)).orderBy(groupsTable.groupNumber);
      if (!validBreakoutGroups(rows, new Set(groups.map((group) => group.id)))) throw new ActionError(409, "Configure the groups for both breakout brackets first");
      if (rows.some((row) => row.seeds.length > 0)) throw new ActionError(409, "Breakout brackets already generated");
      const [legacy] = await tx.select({ id: knockoutMatchesTable.id }).from(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, id));
      if (legacy) throw new ActionError(409, "A knockout bracket already exists");
      const manual = body.data.brackets;
      if (manual && (manual.length !== 2 || new Set(manual.map((entry) => entry.bracketId)).size !== 2 ||
        manual.some((entry) => !rows.some((row) => row.id === entry.bracketId)))) {
        throw new ActionError(400, "Provide seed selections for both configured brackets");
      }
      const qualification = manual ? null : await getBreakoutQualification(tournament, groups, tx);
      if (qualification && !qualification.ready) throw new ActionError(409, qualification.message ?? "Qualification is not ready");
      for (const row of rows) {
        const seeds = manual
          ? manual.find((entry) => entry.bracketId === row.id)!.qualifierTeamIds
          : qualification!.qualifiers.filter((qualifier) => row.groupIds.includes(qualifier.groupId)).map((qualifier) => qualifier.teamId);
        if (tournament.knockoutFormat === "top6" && seeds.length !== 6) {
          throw new ActionError(409, `${row.name} needs exactly six qualifying teams for Top 6 Playoff`);
        }
        if (seeds.length < 2 || seeds.length > 64) throw new ActionError(409, `${row.name} needs between 2 and 64 qualifying teams`);
        if (manual) {
          const teams = await tx.select().from(teamsTable).where(inArray(teamsTable.groupId, row.groupIds));
          const allowed = new Set(teams.map((team) => team.id));
          if (new Set(seeds).size !== seeds.length || seeds.some((teamId) => !Number.isSafeInteger(teamId) || !allowed.has(teamId))) {
            throw new ActionError(400, "Each seeded team must be distinct and belong to a group assigned to its bracket");
          }
        }
        await tx.update(breakoutKnockoutsTable).set({ seeds, scores: {} }).where(eq(breakoutKnockoutsTable.id, row.id));
      }
    });
    broadcast(id);
    res.status(201).json(GenerateBreakoutKnockoutsResponse.parse(await getState(id)));
  } catch (error) {
    if (error instanceof ActionError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.delete("/tournaments/:id/breakout-knockouts/matches", requireAuth, async (req, res): Promise<void> => {
  const params = ResetBreakoutKnockoutsParams.safeParse(req.params);
  if (!params.success || !validIds(params.data)) { res.status(400).json({ error: "Invalid tournament" }); return; }
  const id = params.data.id;
  try {
    await manage(id, req, async (tx) => {
      await tx.update(breakoutKnockoutsTable).set({ seeds: [], scores: {} }).where(eq(breakoutKnockoutsTable.tournamentId, id));
    });
    broadcast(id);
    res.json(ResetBreakoutKnockoutsResponse.parse(await getState(id)));
  } catch (error) {
    if (error instanceof ActionError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.put("/tournaments/:id/breakout-knockouts/:bracketId/matches/:matchId", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateBreakoutKnockoutScoreParams.safeParse(req.params);
  const body = UpdateBreakoutKnockoutScoreBody.safeParse(req.body);
  if (!params.success || !validIds(params.data) || !body.success) { res.status(400).json({ error: "Enter whole-number scores of zero or more" }); return; }
  const { id, bracketId, matchId } = params.data;
  const { homeScore, awayScore } = body.data;
  if ((homeScore !== null && !Number.isSafeInteger(homeScore)) || (awayScore !== null && !Number.isSafeInteger(awayScore))) {
    res.status(400).json({ error: "Scores must be whole numbers" }); return;
  }
  if ((homeScore === null) !== (awayScore === null) || (homeScore !== null && homeScore === awayScore)) {
    res.status(400).json({ error: "A knockout game needs a winner. Clear both scores to reset a result." }); return;
  }
  try {
    await manage(id, req, async (tx) => {
      const [row] = await tx.select().from(breakoutKnockoutsTable).where(and(eq(breakoutKnockoutsTable.id, bracketId), eq(breakoutKnockoutsTable.tournamentId, id)));
      if (!row) throw new ActionError(404, "Bracket not found");
      const match = computeBreakoutBracket(row.seeds, row.scores).matches.find((match) => match.id === matchId);
      if (!match) throw new ActionError(404, "Match not found");
      if (!match.ready || match.homeTeamId === null || match.awayTeamId === null || match.bye) throw new ActionError(409, "Both teams must be known before scoring this match");
      const scores = { ...row.scores };
      if (homeScore === null || awayScore === null) delete scores[String(matchId)];
      else scores[String(matchId)] = { homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId, homeScore, awayScore };
      const computed = computeBreakoutBracket(row.seeds, scores);
      await tx.update(breakoutKnockoutsTable).set({ scores: computed.validScores }).where(eq(breakoutKnockoutsTable.id, bracketId));
    });
    broadcast(id);
    res.json(UpdateBreakoutKnockoutScoreResponse.parse(await getState(id)));
  } catch (error) {
    if (error instanceof ActionError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.put("/groups/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateGroupNameParams.safeParse(req.params);
  const body = UpdateGroupNameBody.safeParse(req.body);
  if (!params.success || !validIds(params.data) || !body.success || !body.data.name.trim()) { res.status(400).json({ error: "Group names must be 1 to 80 characters" }); return; }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, params.data.id));
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, group.tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  if (!await canManageTournament(tournament, userId, await isAdminUser(userId))) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") { res.status(409).json({ error: "Reopen the tournament before renaming groups" }); return; }
  const [updated] = await db.update(groupsTable).set({ name: body.data.name.trim() }).where(eq(groupsTable.id, group.id)).returning();
  broadcast(tournament.id);
  res.json(UpdateGroupNameResponse.parse(updated));
});

export default router;
