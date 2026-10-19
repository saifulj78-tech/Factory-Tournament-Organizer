import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { compareWildcardCandidates } from "./wildcard-ranking.js";
import { calculateWildcardPlayoffStandings, selectThirdPlaceCandidates } from "./wildcard-playoff-ranking.js";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getAuth, createClerkClient } from "@clerk/express";
import {
  db, tournamentTable, groupsTable, teamsTable, matchesTable, organizersTable,
  knockoutMatchesTable, tournamentCoOrganizersTable, ladderParticipantsTable,
  wildcardPlayoffMatchesTable,
  breakoutKnockoutsTable,
  ladderCourtsTable, ladderGamesTable, teamEventConfigsTable, teamEventRubberTemplatesTable,
  teamEventRubbersTable, teamEventDreambreakersTable,
} from "@workspace/db";
import { subscribe, broadcast } from "../lib/sseBroadcaster";
import { reconcileSingleEliminationTeamChange } from "../lib/knockoutTeamChange";
import { topSixSlots } from "../lib/topSix";
import {
  buildAmericanoRound, buildAmericanoRoundAvoidingPartners, buildNextLadderRound, getLadderState, loserMovement, splitAcrossCourts, takeNextGame,
  playerIdsExist, winnerMovement,
} from "../lib/ladder";

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// Cache userId → isAdmin to avoid repeated Clerk API calls
const adminCache = new Map<string, boolean>();
// Cache userId → primary email (cleared on organizer delete)
const emailCache = new Map<string, string>();

async function getUserEmail(userId: string): Promise<string> {
  if (emailCache.has(userId)) return emailCache.get(userId)!;
  const user = await clerkClient.users.getUser(userId);
  const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? "";
  emailCache.set(userId, email);
  return email;
}

export async function isAdminUser(userId: string): Promise<boolean> {
  if (adminCache.has(userId)) return adminCache.get(userId)!;
  try {
    const email = await getUserEmail(userId);
    const result = email.toLowerCase() === (process.env.ADMIN_EMAIL ?? "").toLowerCase();
    adminCache.set(userId, result);
    return result;
  } catch {
    return false;
  }
}

/** Returns true if userId is a co-organizer of the given tournament. */
async function isCoOrganizer(tournamentId: number, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tournamentCoOrganizersTable.id })
    .from(tournamentCoOrganizersTable)
    .where(and(
      eq(tournamentCoOrganizersTable.tournamentId, tournamentId),
      eq(tournamentCoOrganizersTable.userId, userId),
    ));
  return !!row;
}

/** Returns true if the user can manage the tournament (owner, admin, or co-organizer). */
export async function canManageTournament(
  tournament: { id: number; createdBy: string | null },
  userId: string,
  admin: boolean,
): Promise<boolean> {
  if (admin) return true;
  if (tournament.createdBy === userId) return true;
  return isCoOrganizer(tournament.id, userId);
}

async function checkAccessExpiry(userId: string): Promise<"ok" | "expired"> {
  try {
    const email = await getUserEmail(userId);
    const [row] = await db.select().from(organizersTable).where(eq(organizersTable.email, email.toLowerCase()));
    if (row?.expiresAt && new Date(row.expiresAt) < new Date()) return "expired";
    return "ok";
  } catch {
    return "ok"; // fail open — don't block on DB errors
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = auth.userId;
  (req as Request & { userId: string }).userId = userId;
  // Skip expiry check for admin
  isAdminUser(userId).then((admin) => {
    if (admin) { next(); return; }
    return checkAccessExpiry(userId).then((status) => {
      if (status === "expired") {
        res.status(403).json({ error: "Access expired", code: "ACCESS_EXPIRED" });
      } else {
        next();
      }
    });
  }).catch(() => next()); // fail open
}
import {
  ListTournamentsResponse,
  CreateTournamentBody,
  CreateTournamentResponse,
  GetTournamentByIdParams,
  GetTournamentByIdResponse,
  UpdateTournamentByIdParams,
  UpdateTournamentByIdBody,
  UpdateTournamentByIdResponse,
  DeleteTournamentByIdParams,
  GenerateTournamentParams,
  GenerateTournamentResponse,
  CompleteTournamentParams,
  CompleteTournamentResponse,
  ReopenTournamentParams,
  ReopenTournamentResponse,
  ListTournamentGroupsParams,
  ListTournamentGroupsResponse,
  ListTournamentTeamsParams,
  ListTournamentTeamsResponse,
  CreateTournamentTeamParams,
  CreateTournamentTeamBody,
  CreateTournamentTeamResponse,
  ListTournamentMatchesParams,
  ListTournamentMatchesResponse,
  CreateTournamentMatchParams,
  CreateTournamentMatchBody,
  CreateTournamentMatchResponse,
  ListTournamentStandingsParams,
  ListTournamentStandingsResponse,
  UpdateTeamParams,
  UpdateTeamBody,
  UpdateTeamResponse,
  DeleteTeamParams,
  ReplaceAndDeleteTeamParams,
  ReplaceAndDeleteTeamBody,
  ReplaceAndDeleteTeamResponse,
  UpdateMatchParams,
  UpdateMatchBody,
  UpdateMatchResponse,
  DeleteMatchParams,
  RandomizeTeamsParams,
  RandomizeTeamsBody,
  RandomizeTeamsResponse,
  ListTournamentCoOrganizersParams,
  ListTournamentCoOrganizersResponse,
  AddTournamentCoOrganizerParams,
  AddTournamentCoOrganizerBody,
  AddTournamentCoOrganizerResponse,
  RemoveTournamentCoOrganizerParams,
  ListLadderStateParams,
  ListLadderStateResponse,
  SetLadderParticipantsParams,
  SetLadderParticipantsBody,
  SetLadderParticipantsResponse,
  UpdateLadderParticipantAttendanceParams,
  UpdateLadderParticipantAttendanceBody,
  UpdateLadderParticipantAttendanceResponse,
  StartLadderParams,
  StartLadderResponse,
  ResetLadderParams,
  ResetLadderResponse,
  UpdateLadderGameParams,
  UpdateLadderGameBody,
  UpdateLadderGameResponse,
  DeleteKnockoutBracketParams,
  GetWildcardPlayoffParams,
  GetWildcardPlayoffResponse,
  StartWildcardPlayoffParams,
  StartWildcardPlayoffResponse,
  ResetWildcardPlayoffParams,
  UpdateWildcardPlayoffMatchParams,
  UpdateWildcardPlayoffMatchBody,
  UpdateWildcardPlayoffMatchResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function buildRoundRobin(teamIds: number[]): Array<Array<[number, number]>> {
  const list = [...teamIds];
  const hasBye = list.length % 2 !== 0;
  if (hasBye) list.push(-1);
  const n = list.length;
  const numRounds = n - 1;
  const matchesPerRound = n / 2;
  const rounds: Array<Array<[number, number]>> = [];
  for (let r = 0; r < numRounds; r++) {
    const round: Array<[number, number]> = [];
    for (let i = 0; i < matchesPerRound; i++) {
      const home = list[i];
      const away = list[n - 1 - i];
      if (home !== -1 && away !== -1) round.push([home, away]);
    }
    rounds.push(round);
    const last = list[n - 1];
    for (let i = n - 1; i > 1; i--) list[i] = list[i - 1];
    list[1] = last;
  }
  return rounds;
}

async function getGroupIdsForTournament(tournamentId: number): Promise<number[]> {
  const groups = await db
    .select({ id: groupsTable.id })
    .from(groupsTable)
    .where(eq(groupsTable.tournamentId, tournamentId));
  return groups.map((g) => g.id);
}

type ScheduleEntry = { groupId: number; homeTeamId: number; awayTeamId: number };

async function insertScheduledMatches(
  groups: { id: number }[],
  teamsByGroup: Map<number, number[]>,
  courtCount: number,
  tournamentId?: number,
): Promise<void> {
  // Build a flat ordered match list per group (round-robin order preserved within each group).
  // Then interleave across groups by cycling 1 match per group at a time, so groups are
  // spread as evenly as possible regardless of court count or group count.
  const perGroupFlat: ScheduleEntry[][] = groups.map((group) => {
    const ids = teamsByGroup.get(group.id) ?? [];
    const flat: ScheduleEntry[] = [];
    for (const round of buildRoundRobin(ids)) {
      for (const [h, a] of round) {
        flat.push({ groupId: group.id, homeTeamId: h, awayTeamId: a });
      }
    }
    return flat;
  });

  // Cycle through groups, taking 1 match per group per pass.
  const allMatches: ScheduleEntry[] = [];
  const cursors = perGroupFlat.map(() => 0);
  let anyRemaining = true;
  while (anyRemaining) {
    anyRemaining = false;
    for (let gi = 0; gi < perGroupFlat.length; gi++) {
      if (cursors[gi] < perGroupFlat[gi].length) {
        allMatches.push(perGroupFlat[gi][cursors[gi]++]);
        anyRemaining = true;
      }
    }
  }

  // Assign to physical rounds in batches of courtCount.
  let slotNumber = 1;
  for (let i = 0; i < allMatches.length; i += courtCount) {
    const batch = allMatches.slice(i, i + courtCount);
    for (let ci = 0; ci < batch.length; ci++) {
      const { groupId, homeTeamId, awayTeamId } = batch[ci];
        const [match] = await db.insert(matchesTable).values({ groupId, homeTeamId, awayTeamId, played: false, roundNumber: slotNumber, courtNumber: ci + 1 }).returning();
        if (tournamentId) {
          const templates = await db.select().from(teamEventRubberTemplatesTable)
            .where(and(eq(teamEventRubberTemplatesTable.tournamentId, tournamentId), eq(teamEventRubberTemplatesTable.stage, "group")));
          if (templates.length) await db.insert(teamEventRubbersTable).values(templates.map((template) => ({
            groupMatchId: match.id, order: template.order, matchType: template.matchType,
            targetPoints: template.targetPoints, bestOf: template.bestOf,
            disallowSameMaleFromPreviousMixed: template.disallowSameMaleFromPreviousMixed,
          })));
        }
    }
    slotNumber++;
  }
}

type RawMatch = {
  id: number;
  groupId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  played: boolean;
  startedAt: Date | null;
  roundNumber: number;
  courtNumber: number | null;
};

async function enrichMatches(rawMatches: RawMatch[]) {
  if (rawMatches.length === 0) return [];
  const teamIds = [...new Set([...rawMatches.map((m) => m.homeTeamId), ...rawMatches.map((m) => m.awayTeamId)])];
  const teams = await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds));
  const teamsById = Object.fromEntries(teams.map((t) => [t.id, t]));
  return rawMatches.map((m) => ({
    ...m,
    startedAt: m.startedAt?.toISOString() ?? null,
    homeTeamName: teamsById[m.homeTeamId]?.name ?? null,
    awayTeamName: teamsById[m.awayTeamId]?.name ?? null,
  }));
}

function serializeTournament(t: typeof tournamentTable.$inferSelect) {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    wildcardSelectionMethod: t.wildcardSelectionMethod ?? "ranking",
  };
}

function validWildcardPlayoffSettings(settings: {
  format?: string;
  groupCount: number;
  teamsPerGroup: number;
  qualifiersPerGroup?: number | null;
  wildcardQualifiers?: number;
  wildcardSelectionMethod?: string;
}): boolean {
  return settings.wildcardSelectionMethod !== "round_robin" ||
    (settings.format === "group_knockout" && settings.groupCount === 3 &&
      settings.teamsPerGroup >= 3 && settings.qualifiersPerGroup === 2 && settings.wildcardQualifiers === 2);
}

/* ── Tournaments CRUD ─────────────────────────────────── */

router.get("/tournaments", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  let rows;
  if (admin) {
    rows = await db.select().from(tournamentTable).orderBy(tournamentTable.createdAt);
  } else {
    const coOrgRows = await db
      .select({ tournamentId: tournamentCoOrganizersTable.tournamentId })
      .from(tournamentCoOrganizersTable)
      .where(eq(tournamentCoOrganizersTable.userId, userId));
    const coOrgIds = coOrgRows.map((r) => r.tournamentId);
    rows = coOrgIds.length > 0
      ? await db.select().from(tournamentTable)
          .where(or(eq(tournamentTable.createdBy, userId), inArray(tournamentTable.id, coOrgIds)))
          .orderBy(tournamentTable.createdAt)
      : await db.select().from(tournamentTable)
          .where(eq(tournamentTable.createdBy, userId))
          .orderBy(tournamentTable.createdAt);
  }
  res.json(ListTournamentsResponse.parse(rows.map(serializeTournament)));
});

router.post("/tournaments", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateTournamentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (!validWildcardPlayoffSettings(parsed.data)) {
    res.status(400).json({ error: "The third-place qualifier playoff needs three groups of at least three teams, two qualifiers per group, and two additional places." });
    return;
  }
  if (parsed.data.format && ["individual_ladder", "americano"].includes(parsed.data.format) && !ladderCourtCountIsValid(parsed.data.courtCount, parsed.data.format)) {
    res.status(400).json({ error: parsed.data.format === "americano" ? "Americano supports 1 to 3 courts" : "Individual Ladder supports exactly 2 or 3 courts" });
    return;
  }
  const userId = (req as Request & { userId: string }).userId;
  const [t] = await db.insert(tournamentTable).values({
    ...parsed.data,
    wildcardRankingMethod: parsed.data.wildcardRankingMethod ?? "points",
    wildcardSelectionMethod: parsed.data.wildcardSelectionMethod ?? "ranking",
    createdBy: userId,
  }).returning();
  if (t.format === "team_event") {
    await db.insert(teamEventConfigsTable).values({ tournamentId: t.id });
    await db.insert(teamEventRubberTemplatesTable).values([
      { tournamentId: t.id, stage: "group", order: 1, matchType: "mens_doubles", targetPoints: 21, bestOf: 1 },
      { tournamentId: t.id, stage: "group", order: 2, matchType: "mixed_doubles", targetPoints: 21, bestOf: 1 },
      { tournamentId: t.id, stage: "knockout", order: 1, matchType: "mens_doubles", targetPoints: 21, bestOf: 1 },
      { tournamentId: t.id, stage: "knockout", order: 2, matchType: "mixed_doubles", targetPoints: 21, bestOf: 1 },
      { tournamentId: t.id, stage: "knockout", order: 3, matchType: "mixed_doubles", targetPoints: 21, bestOf: 1, disallowSameMaleFromPreviousMixed: true },
    ]);
  }
  res.status(201).json(CreateTournamentResponse.parse(serializeTournament(t)));
});

router.get("/tournaments/:id", async (req, res): Promise<void> => {
  const params = GetTournamentByIdParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [t] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!t) { res.status(404).json({ error: "Tournament not found" }); return; }
  res.json(GetTournamentByIdResponse.parse(serializeTournament(t)));
});

router.put("/tournaments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateTournamentByIdParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateTournamentByIdBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(existing, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (existing.status === "completed") { res.status(409).json({ error: "Cannot edit a completed tournament" }); return; }
  const nextFormat = parsed.data.format ?? "round_robin";
  const configuredBreakouts = await db.query.breakoutKnockoutsTable.findFirst({
    where: eq(breakoutKnockoutsTable.tournamentId, existing.id),
  });
  if ((parsed.data.knockoutFormat ?? "single") !== (existing.knockoutFormat ?? "single")) {
    const legacy = await db.select({ id: knockoutMatchesTable.id }).from(knockoutMatchesTable)
      .where(eq(knockoutMatchesTable.tournamentId, existing.id));
    const breakouts = configuredBreakouts
      ? await db.select().from(breakoutKnockoutsTable).where(eq(breakoutKnockoutsTable.tournamentId, existing.id))
      : [];
    if (legacy.length || breakouts.some((bracket) => bracket.seeds.length > 0)) {
      res.status(409).json({ error: "Reset the existing knockout brackets before changing knockout format. Resetting clears their knockout results." });
      return;
    }
  }
  if (configuredBreakouts && !["round_robin", "group_knockout"].includes(nextFormat)) {
    res.status(409).json({ error: "Reset and disable the breakout knockouts before changing to a different tournament format" });
    return;
  }
  if (!validWildcardPlayoffSettings({
    ...parsed.data,
    format: configuredBreakouts && nextFormat === "round_robin" ? "group_knockout" : nextFormat,
    wildcardSelectionMethod: parsed.data.wildcardSelectionMethod ?? existing.wildcardSelectionMethod,
  })) {
    res.status(400).json({ error: "The third-place qualifier playoff needs three groups of at least three teams, two qualifiers per group, and two additional places." });
    return;
  }
  if (["individual_ladder", "americano"].includes(nextFormat) && !ladderCourtCountIsValid(parsed.data.courtCount, nextFormat)) {
    res.status(400).json({ error: nextFormat === "americano" ? "Americano supports 1 to 3 courts" : "Individual Ladder supports exactly 2 or 3 courts" });
    return;
  }
  if (["individual_ladder", "americano"].includes(nextFormat) && !["individual_ladder", "americano"].includes(existing.format)) {
    const [existingGroup] = await db.select({ id: groupsTable.id }).from(groupsTable)
      .where(eq(groupsTable.tournamentId, existing.id))
      .limit(1);
    if (existingGroup) {
      res.status(409).json({ error: "Create a new tournament for an Individual Ladder after group fixtures have been generated" });
      return;
    }
  }
  if (["individual_ladder", "americano"].includes(existing.format) && (
    nextFormat !== existing.format || parsed.data.courtCount !== existing.courtCount
  )) {
    const games = await db.select({ id: ladderGamesTable.id }).from(ladderGamesTable)
      .where(eq(ladderGamesTable.tournamentId, existing.id));
    if (games.length > 0) {
      res.status(409).json({ error: "Reset the ladder before changing its format or court count" });
      return;
    }
  }
  const [t] = await db
    .update(tournamentTable)
    .set({
      name: parsed.data.name,
      groupCount: parsed.data.groupCount,
      teamsPerGroup: parsed.data.teamsPerGroup,
      courtCount: parsed.data.courtCount,
       format: nextFormat,
      qualifiersPerGroup: parsed.data.qualifiersPerGroup ?? null,
      wildcardQualifiers: parsed.data.wildcardQualifiers ?? 0,
      wildcardRankingMethod: parsed.data.wildcardRankingMethod ?? existing.wildcardRankingMethod ?? "points",
      wildcardSelectionMethod: parsed.data.wildcardSelectionMethod ?? existing.wildcardSelectionMethod ?? "ranking",
      knockoutFormat: (parsed.data as { knockoutFormat?: string }).knockoutFormat ?? "single",
      thirdPlacePlayoffEnabled: parsed.data.thirdPlacePlayoffEnabled ?? true,
      tiebreakerOrder: (parsed.data as { tiebreakerOrder?: string }).tiebreakerOrder ?? "goal_difference,goals_for,goals_against,head_to_head",
    })
    .where(eq(tournamentTable.id, params.data.id))
    .returning();
  if (!t) { res.status(404).json({ error: "Tournament not found" }); return; }
  if (t.format === "team_event" && existing.format !== "team_event") {
    await db.transaction(async (tx) => {
      const [config] = await tx.select({ id: teamEventConfigsTable.id }).from(teamEventConfigsTable)
        .where(eq(teamEventConfigsTable.tournamentId, t.id));
      if (!config) await tx.insert(teamEventConfigsTable).values({ tournamentId: t.id });
      const templates = await tx.select({ id: teamEventRubberTemplatesTable.id }).from(teamEventRubberTemplatesTable)
        .where(eq(teamEventRubberTemplatesTable.tournamentId, t.id));
      if (!templates.length) await tx.insert(teamEventRubberTemplatesTable).values([
        { tournamentId: t.id, stage: "group", order: 1, matchType: "mens_doubles", targetPoints: 21, bestOf: 1 },
        { tournamentId: t.id, stage: "group", order: 2, matchType: "mixed_doubles", targetPoints: 21, bestOf: 1 },
        { tournamentId: t.id, stage: "knockout", order: 1, matchType: "mens_doubles", targetPoints: 21, bestOf: 1 },
        { tournamentId: t.id, stage: "knockout", order: 2, matchType: "mixed_doubles", targetPoints: 21, bestOf: 1 },
        { tournamentId: t.id, stage: "knockout", order: 3, matchType: "mixed_doubles", targetPoints: 21, bestOf: 1, disallowSameMaleFromPreviousMixed: true },
      ]);
    });
  }
  broadcast(t.id);
  res.json(UpdateTournamentByIdResponse.parse(serializeTournament(t)));
});

router.delete("/tournaments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteTournamentByIdParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [existing] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (existing) {
    const userId = (req as Request & { userId: string }).userId;
    const admin = await isAdminUser(userId);
    if (!admin && existing.createdBy !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
  }
  const groupIds = await getGroupIdsForTournament(params.data.id);
  if (groupIds.length > 0) {
    await db.delete(matchesTable).where(inArray(matchesTable.groupId, groupIds));
    await db.delete(teamsTable).where(inArray(teamsTable.groupId, groupIds));
    await db.delete(groupsTable).where(inArray(groupsTable.id, groupIds));
  }
  await db.delete(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  res.sendStatus(204);
});

/* ── Tournament actions ───────────────────────────────── */

router.post("/tournaments/:id/generate", requireAuth, async (req, res): Promise<void> => {
  const params = GenerateTournamentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  // Ownership check — must own or co-organize the tournament, or be admin
  const genUserId = (req as Request & { userId: string }).userId;
  const genAdmin = await isAdminUser(genUserId);
  if (!await canManageTournament(tournament, genUserId, genAdmin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot regenerate a completed tournament" }); return; }

  // Clear any existing knockout bracket first
  await db.delete(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, params.data.id));
  await db.delete(wildcardPlayoffMatchesTable).where(eq(wildcardPlayoffMatchesTable.tournamentId, params.data.id));
  await db.delete(breakoutKnockoutsTable).where(eq(breakoutKnockoutsTable.tournamentId, params.data.id));

  const oldGroupIds = await getGroupIdsForTournament(params.data.id);
  if (oldGroupIds.length > 0) {
    await db.delete(matchesTable).where(inArray(matchesTable.groupId, oldGroupIds));
    await db.delete(teamsTable).where(inArray(teamsTable.groupId, oldGroupIds));
    await db.delete(groupsTable).where(inArray(groupsTable.id, oldGroupIds));
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const groups: { id: number; groupNumber: number }[] = [];
  for (let i = 0; i < tournament.groupCount; i++) {
    const [group] = await db
      .insert(groupsTable)
      .values({ name: `Group ${alphabet[i] ?? String(i + 1)}`, groupNumber: i + 1, tournamentId: tournament.id })
      .returning();
    groups.push(group);
  }

  const teamsByGroup: Map<number, number[]> = new Map();
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const ids: number[] = [];
    for (let ti = 0; ti < tournament.teamsPerGroup; ti++) {
      const [team] = await db
        .insert(teamsTable)
        .values({ name: `Team ${gi * tournament.teamsPerGroup + ti + 1}`, groupId: group.id })
        .returning();
      ids.push(team.id);
    }
    teamsByGroup.set(group.id, ids);
  }

  await insertScheduledMatches(groups, teamsByGroup, tournament.courtCount, tournament.format === "team_event" ? tournament.id : undefined);

  broadcast(tournament.id);
  res.json(GenerateTournamentResponse.parse(serializeTournament(tournament)));
});

router.post("/tournaments/:id/regenerate-matches", requireAuth, async (req, res): Promise<void> => {
  const params = GenerateTournamentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  // Ownership check — must own or co-organize the tournament, or be admin
  const regenUserId = (req as Request & { userId: string }).userId;
  const regenAdmin = await isAdminUser(regenUserId);
  if (!await canManageTournament(tournament, regenUserId, regenAdmin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot regenerate matches for a completed tournament" }); return; }

  const groupRows = await db.select().from(groupsTable).where(eq(groupsTable.tournamentId, tournament.id));
  if (groupRows.length === 0) { res.status(409).json({ error: "No groups exist — generate the tournament first" }); return; }

  const groupIds = groupRows.map((g) => g.id);
  await db.delete(matchesTable).where(inArray(matchesTable.groupId, groupIds));
  // Also clear any knockout bracket since group stage is being reset
  await db.delete(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, tournament.id));
  await db.delete(wildcardPlayoffMatchesTable).where(eq(wildcardPlayoffMatchesTable.tournamentId, tournament.id));
  await db.update(breakoutKnockoutsTable).set({ seeds: [], scores: {} }).where(eq(breakoutKnockoutsTable.tournamentId, tournament.id));

  const allTeams = await db.select().from(teamsTable).where(inArray(teamsTable.groupId, groupIds));
  const teamsByGroup = new Map<number, number[]>();
  for (const team of allTeams) {
    const list = teamsByGroup.get(team.groupId) ?? [];
    list.push(team.id);
    teamsByGroup.set(team.groupId, list);
  }

  await insertScheduledMatches(groupRows, teamsByGroup, tournament.courtCount, tournament.format === "team_event" ? tournament.id : undefined);

  broadcast(tournament.id);
  res.json(GenerateTournamentResponse.parse(serializeTournament(tournament)));
});

router.post("/tournaments/:id/complete", requireAuth, async (req, res): Promise<void> => {
  const params = CompleteTournamentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [existing] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(existing, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  const [t] = await db
    .update(tournamentTable)
    .set({ status: "completed" })
    .where(eq(tournamentTable.id, params.data.id))
    .returning();
  if (!t) { res.status(404).json({ error: "Tournament not found" }); return; }
  res.json(CompleteTournamentResponse.parse(serializeTournament(t)));
});

router.post("/tournaments/:id/reopen", requireAuth, async (req, res): Promise<void> => {
  const params = ReopenTournamentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [existing] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(existing, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  const [t] = await db
    .update(tournamentTable)
    .set({ status: "active" })
    .where(eq(tournamentTable.id, params.data.id))
    .returning();
  if (!t) { res.status(404).json({ error: "Tournament not found" }); return; }
  res.json(ReopenTournamentResponse.parse(serializeTournament(t)));
});

/* ── Co-organizers ────────────────────────────────────── */

router.get("/tournaments/:id/co-organizers", requireAuth, async (req, res): Promise<void> => {
  const params = ListTournamentCoOrganizersParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  const rows = await db
    .select()
    .from(tournamentCoOrganizersTable)
    .where(eq(tournamentCoOrganizersTable.tournamentId, params.data.id));
  res.json(ListTournamentCoOrganizersResponse.parse(rows.map((r) => ({ ...r, addedAt: r.addedAt.toISOString() }))));
});

router.post("/tournaments/:id/co-organizers", requireAuth, async (req, res): Promise<void> => {
  const params = AddTournamentCoOrganizerParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = AddTournamentCoOrganizerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }

  // Only the owner (or admin) can manage co-organizers
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!admin && tournament.createdBy !== userId) { res.status(403).json({ error: "Only the tournament owner can manage co-organizers" }); return; }

  const email = parsed.data.email.toLowerCase();

  // Look up the user in Clerk by email
  const clerkResult = await clerkClient.users.getUserList({ emailAddress: [email] });
  const clerkUser = clerkResult.data?.[0];
  if (!clerkUser) { res.status(404).json({ error: `No account found for ${email}. They must sign in at least once first.` }); return; }

  // Prevent adding yourself
  if (clerkUser.id === tournament.createdBy) { res.status(400).json({ error: "The owner is already the organizer of this tournament" }); return; }

  // Prevent duplicates
  const [existing] = await db
    .select()
    .from(tournamentCoOrganizersTable)
    .where(and(
      eq(tournamentCoOrganizersTable.tournamentId, params.data.id),
      eq(tournamentCoOrganizersTable.userId, clerkUser.id),
    ));
  if (existing) { res.status(409).json({ error: `${email} is already a co-organizer` }); return; }

  const [row] = await db.insert(tournamentCoOrganizersTable).values({
    tournamentId: params.data.id,
    userId: clerkUser.id,
    email,
  }).returning();

  res.status(201).json(AddTournamentCoOrganizerResponse.parse({ ...row, addedAt: row.addedAt.toISOString() }));
});

router.delete("/tournaments/:id/co-organizers/:userId", requireAuth, async (req, res): Promise<void> => {
  const params = RemoveTournamentCoOrganizerParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }

  // Only the owner (or admin) can remove co-organizers
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!admin && tournament.createdBy !== userId) { res.status(403).json({ error: "Only the tournament owner can manage co-organizers" }); return; }

  await db
    .delete(tournamentCoOrganizersTable)
    .where(and(
      eq(tournamentCoOrganizersTable.tournamentId, params.data.id),
      eq(tournamentCoOrganizersTable.userId, params.data.userId),
    ));
  res.sendStatus(204);
});

/* ── Tournament sub-resources ─────────────────────────── */

router.get("/tournaments/:id/groups", async (req, res): Promise<void> => {
  const params = ListTournamentGroupsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const groups = await db.select().from(groupsTable).where(eq(groupsTable.tournamentId, params.data.id)).orderBy(groupsTable.groupNumber);
  res.json(ListTournamentGroupsResponse.parse(groups));
});

router.get("/tournaments/:id/teams", async (req, res): Promise<void> => {
  const params = ListTournamentTeamsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const groupIds = await getGroupIdsForTournament(params.data.id);
  if (groupIds.length === 0) { res.json(ListTournamentTeamsResponse.parse([])); return; }
  const teams = await db.select().from(teamsTable).where(inArray(teamsTable.groupId, groupIds)).orderBy(teamsTable.id);
  res.json(ListTournamentTeamsResponse.parse(teams));
});

router.post("/tournaments/:id/teams", requireAuth, async (req, res): Promise<void> => {
  const params = CreateTournamentTeamParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateTournamentTeamBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot add teams to a completed tournament" }); return; }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, parsed.data.groupId));
  if (!group || group.tournamentId !== params.data.id) { res.status(400).json({ error: "Group does not belong to this tournament" }); return; }
  const [team] = await db.insert(teamsTable).values(parsed.data).returning();
  res.status(201).json(CreateTournamentTeamResponse.parse(team));
});

router.post("/tournaments/:id/randomize-teams", requireAuth, async (req, res): Promise<void> => {
  const params = RandomizeTeamsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = RandomizeTeamsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const rtUserId = (req as Request & { userId: string }).userId;
  const rtAdmin = await isAdminUser(rtUserId);
  if (!await canManageTournament(tournament, rtUserId, rtAdmin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot modify a completed tournament" }); return; }

  const groupRows = await db.select().from(groupsTable)
    .where(eq(groupsTable.tournamentId, params.data.id))
    .orderBy(groupsTable.groupNumber);
  if (groupRows.length === 0) {
    res.status(409).json({ error: "No groups yet — generate the tournament first" }); return;
  }

  const { teamNames } = parsed.data;
  const groupIds = groupRows.map((g) => g.id);

  // Wipe existing teams and matches (and knockout bracket)
  await db.delete(matchesTable).where(inArray(matchesTable.groupId, groupIds));
  await db.delete(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, params.data.id));
  await db.delete(wildcardPlayoffMatchesTable).where(eq(wildcardPlayoffMatchesTable.tournamentId, params.data.id));
  await db.update(breakoutKnockoutsTable).set({ seeds: [], scores: {} }).where(eq(breakoutKnockoutsTable.tournamentId, params.data.id));
  await db.delete(teamsTable).where(inArray(teamsTable.groupId, groupIds));

  // Fisher-Yates shuffle
  const shuffled = [...teamNames];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Distribute teams round-robin across groups so they fill as evenly as possible
  const teamsByGroup = new Map<number, number[]>(groupRows.map((g) => [g.id, []]));
  for (let i = 0; i < shuffled.length; i++) {
    const group = groupRows[i % groupRows.length];
    const [team] = await db.insert(teamsTable)
      .values({ name: shuffled[i], groupId: group.id })
      .returning();
    teamsByGroup.get(group.id)!.push(team.id);
  }

  // Regenerate matches for the new team layout
  await insertScheduledMatches(groupRows, teamsByGroup, tournament.courtCount);

  // Return the full updated team list
  const allTeams = await db.select().from(teamsTable).where(inArray(teamsTable.groupId, groupIds)).orderBy(teamsTable.id);
  broadcast(tournament.id);
  res.json(RandomizeTeamsResponse.parse(allTeams));
});

router.post("/tournaments/:id/matches", requireAuth, async (req, res): Promise<void> => {
  const params = CreateTournamentMatchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateTournamentMatchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot add matches to a completed tournament" }); return; }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, parsed.data.groupId));
  if (!group || group.tournamentId !== params.data.id) { res.status(400).json({ error: "Group does not belong to this tournament" }); return; }
  const [match] = await db
    .insert(matchesTable)
    .values({ groupId: parsed.data.groupId, homeTeamId: parsed.data.homeTeamId, awayTeamId: parsed.data.awayTeamId, played: false, roundNumber: parsed.data.roundNumber, courtNumber: parsed.data.courtNumber ?? null })
    .returning();
  const [enriched] = await enrichMatches([match]);
  res.status(201).json(CreateTournamentMatchResponse.parse(enriched));
});

router.get("/tournaments/:id/matches", async (req, res): Promise<void> => {
  const params = ListTournamentMatchesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const groupIds = await getGroupIdsForTournament(params.data.id);
  if (groupIds.length === 0) { res.json(ListTournamentMatchesResponse.parse([])); return; }
  const raw = await db
    .select({
      id: matchesTable.id,
      groupId: matchesTable.groupId,
      homeTeamId: matchesTable.homeTeamId,
      awayTeamId: matchesTable.awayTeamId,
      homeScore: matchesTable.homeScore,
      awayScore: matchesTable.awayScore,
      played: matchesTable.played,
      startedAt: matchesTable.startedAt,
      roundNumber: matchesTable.roundNumber,
      courtNumber: matchesTable.courtNumber,
    })
    .from(matchesTable)
    .where(inArray(matchesTable.groupId, groupIds))
    .orderBy(matchesTable.roundNumber, matchesTable.courtNumber, matchesTable.id);
  const enriched = await enrichMatches(raw);
  res.json(ListTournamentMatchesResponse.parse(enriched));
});

router.get("/tournaments/:id/standings", async (req, res): Promise<void> => {
  const params = ListTournamentStandingsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const groups = await db.select().from(groupsTable).where(eq(groupsTable.tournamentId, params.data.id)).orderBy(groupsTable.groupNumber);
  const groupIds = groups.map((g) => g.id);
  if (groupIds.length === 0) { res.json(ListTournamentStandingsResponse.parse([])); return; }

  const teams = await db.select().from(teamsTable).where(inArray(teamsTable.groupId, groupIds));
  const allMatches = await db.select().from(matchesTable).where(inArray(matchesTable.groupId, groupIds));
  const groupsById = Object.fromEntries(groups.map((g) => [g.id, g]));

  type StandingRow = {
    groupId: number; groupName: string; teamId: number; teamName: string;
    played: number; wins: number; draws: number; losses: number;
    goalsFor: number; goalsAgainst: number; points: number;
  };

  const standingMap = new Map<number, StandingRow>();
  for (const team of teams) {
    standingMap.set(team.id, {
      groupId: team.groupId, groupName: groupsById[team.groupId]?.name ?? "",
      teamId: team.id, teamName: team.name,
      played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0,
    });
  }

  const playedMatches = allMatches.filter(m => m.played && m.homeScore != null && m.awayScore != null);

  for (const match of playedMatches) {
    const home = standingMap.get(match.homeTeamId);
    const away = standingMap.get(match.awayTeamId);
    if (!home || !away) continue;
    home.played++; away.played++;
    home.goalsFor += match.homeScore!; home.goalsAgainst += match.awayScore!;
    away.goalsFor += match.awayScore!; away.goalsAgainst += match.homeScore!;
    if (match.homeScore! > match.awayScore!) {
      home.wins++; home.points += 3; away.losses++;
    } else if (match.homeScore! < match.awayScore!) {
      away.wins++; away.points += 3; home.losses++;
    }
    // no draws — equal scores do not award points
  }

  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  const cmpFn = makeStandingsComparator(playedMatches, tournament?.tiebreakerOrder);
  const standings = Array.from(standingMap.values()).sort((a, b) => {
    if (a.groupId !== b.groupId) return a.groupId - b.groupId;
    return cmpFn(
      { teamId: a.teamId, pts: a.points, gf: a.goalsFor, ga: a.goalsAgainst, groupId: a.groupId },
      { teamId: b.teamId, pts: b.points, gf: b.goalsFor, ga: b.goalsAgainst, groupId: b.groupId },
    );
  });

  res.json(ListTournamentStandingsResponse.parse(standings));
});

/* ── Team & Match CRUD (id-only, no tournament context needed) ── */

async function getTeamTournament(teamId: number): Promise<typeof tournamentTable.$inferSelect | null> {
  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) return null;
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, team.groupId));
  if (!group) return null;
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, group.tournamentId));
  return tournament ?? null;
}

router.put("/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateTeamParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateTeamBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tournament = await getTeamTournament(params.data.id);
  if (!tournament) { res.status(404).json({ error: "Team not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot edit teams in a completed tournament" }); return; }
  const [team] = await db.update(teamsTable).set(parsed.data).where(eq(teamsTable.id, params.data.id)).returning();
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  res.json(UpdateTeamResponse.parse(team));
});

router.delete("/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteTeamParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tournament = await getTeamTournament(params.data.id);
  if (!tournament) { res.status(404).json({ error: "Team not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot delete teams from a completed tournament" }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from tournament where id = ${tournament.id} for update`);
      const [team] = await tx.select().from(teamsTable).where(eq(teamsTable.id, params.data.id));
      if (!team) throw new Error("TEAM_MISSING");
      const breakoutRows = await tx.select().from(breakoutKnockoutsTable).where(eq(breakoutKnockoutsTable.tournamentId, tournament.id));
      if (breakoutRows.some((row) => row.seeds.includes(team.id))) throw new Error("TEAM_IN_BREAKOUT");
      const playoffMatches = await tx.select({ id: wildcardPlayoffMatchesTable.id })
        .from(wildcardPlayoffMatchesTable)
        .where(and(
          eq(wildcardPlayoffMatchesTable.tournamentId, tournament.id),
          or(eq(wildcardPlayoffMatchesTable.homeTeamId, team.id), eq(wildcardPlayoffMatchesTable.awayTeamId, team.id)),
        ));
      if (playoffMatches.length > 0) throw new Error("TEAM_IN_WILDCARD_PLAYOFF");
      const groupMatches = await tx.select().from(matchesTable)
        .where(or(eq(matchesTable.homeTeamId, team.id), eq(matchesTable.awayTeamId, team.id)));
      const knockoutRows = await tx.select().from(knockoutMatchesTable)
        .where(eq(knockoutMatchesTable.tournamentId, tournament.id));
      const affectedKnockout = knockoutRows.filter(m =>
        m.homeTeamId === team.id || m.awayTeamId === team.id || m.winnerId === team.id);
      const isDouble = knockoutRows.some(m => m.bracket === "winner");
      if (isDouble && affectedKnockout.length > 0 && knockoutRows.some(m =>
        m.played || m.winnerId != null || m.homeScore != null || m.awayScore != null)) {
        throw new Error("SCORED_DOUBLE_ELIM");
      }
      if (groupMatches.length) {
        await tx.delete(matchesTable).where(inArray(matchesTable.id, groupMatches.map(m => m.id)));
      }
      let knockoutChanged = 0;
      let scoresCleared = groupMatches.filter(m =>
        m.played || m.homeScore != null || m.awayScore != null).length;
      let bracketReset = false;
      if (isDouble && affectedKnockout.length) {
        // A fresh double-elimination bracket has no results to preserve.
        // It must be re-seeded after the team is removed rather than leaving
        // holes in both winner and loser paths.
        await tx.delete(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, tournament.id));
        knockoutChanged = knockoutRows.length;
        bracketReset = true;
      } else if (!isDouble && affectedKnockout.length) {
        const reconciliation = reconcileSingleEliminationTeamChange(knockoutRows, team.id, null);
        knockoutChanged = reconciliation.changedIds.length;
        scoresCleared += reconciliation.scoresCleared;
        if (reconciliation.changedIds.length) {
          await tx.update(teamEventRubbersTable)
            .set({ homePlayerIds: [], awayPlayerIds: [], homeScore: null, awayScore: null, games: [], played: false })
            .where(inArray(teamEventRubbersTable.knockoutMatchId, reconciliation.changedIds));
          await tx.update(teamEventDreambreakersTable)
            .set({ firstTeamId: null, homePlayerIds: [], awayPlayerIds: [], homeScore: null, awayScore: null, played: false })
            .where(inArray(teamEventDreambreakersTable.knockoutMatchId, reconciliation.changedIds));
          for (const matchId of reconciliation.changedIds) {
            const match = reconciliation.matches.get(matchId)!;
            await tx.update(knockoutMatchesTable).set({
              homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId,
              homeScore: match.homeScore, awayScore: match.awayScore,
              winnerId: match.winnerId, played: match.played, startedAt: match.startedAt,
            }).where(eq(knockoutMatchesTable.id, matchId));
          }
        }
      }
      await tx.delete(teamsTable).where(eq(teamsTable.id, team.id));
      return { teamName: team.name, groupChanged: groupMatches.length, knockoutChanged, scoresCleared, bracketReset };
    });
    broadcast(tournament.id, {
      type: "fixture_change",
      message: `${result.teamName} was removed. ${result.groupChanged} group fixture(s) removed, ${result.knockoutChanged} knockout fixture(s) adjusted, ${result.scoresCleared} result(s) cleared.${result.bracketReset ? " The unscored double-elimination bracket must be generated again." : ""}`,
    });
    res.sendStatus(204);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "TEAM_MISSING") { res.status(404).json({ error: "Team not found" }); return; }
    if (reason === "TEAM_IN_BREAKOUT") {
      res.status(409).json({ error: "Reset the two breakout knockout brackets before removing this team." });
      return;
    }
    if (reason === "TEAM_IN_WILDCARD_PLAYOFF") {
      res.status(409).json({ error: "Reset the third-place wildcard playoff before removing this team." });
      return;
    }
    if (reason === "SCORED_DOUBLE_ELIM") {
      res.status(409).json({ error: "This team has scored double-elimination matches. Removing it would invalidate both bracket paths; clear those results before removing the team." });
      return;
    }
    throw error;
  }
});

router.post("/teams/:id/replace", requireAuth, async (req, res): Promise<void> => {
  const params = ReplaceAndDeleteTeamParams.safeParse(req.params);
  const body = ReplaceAndDeleteTeamBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose a valid replacement team" }); return;
  }
  const oldId = params.data.id;
  const newId = body.data.replacementTeamId;
  if (oldId === newId) { res.status(400).json({ error: "Select a different team" }); return; }
  const tournament = await getTeamTournament(oldId);
  if (!tournament) { res.status(404).json({ error: "Team not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") {
    res.status(409).json({ error: "Cannot replace teams in a completed tournament" }); return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from tournament where id = ${tournament.id} for update`);
      const [oldTeam] = await tx.select().from(teamsTable).where(eq(teamsTable.id, oldId));
      const [newTeam] = await tx.select().from(teamsTable).where(eq(teamsTable.id, newId));
      if (!oldTeam || !newTeam || oldTeam.groupId !== newTeam.groupId) {
        throw new Error("REPLACEMENT_NOT_IN_GROUP");
      }
      const breakoutRows = await tx.select().from(breakoutKnockoutsTable).where(eq(breakoutKnockoutsTable.tournamentId, tournament.id));
      if (breakoutRows.some((row) => row.seeds.includes(oldId))) throw new Error("TEAM_IN_BREAKOUT");
      const playoffMatches = await tx.select({ id: wildcardPlayoffMatchesTable.id })
        .from(wildcardPlayoffMatchesTable)
        .where(and(
          eq(wildcardPlayoffMatchesTable.tournamentId, tournament.id),
          or(eq(wildcardPlayoffMatchesTable.homeTeamId, oldId), eq(wildcardPlayoffMatchesTable.awayTeamId, oldId)),
        ));
      if (playoffMatches.length > 0) throw new Error("TEAM_IN_WILDCARD_PLAYOFF");
      const groupMatches = await tx.select().from(matchesTable)
        .where(or(eq(matchesTable.homeTeamId, oldId), eq(matchesTable.awayTeamId, oldId)));
      const knockoutMatches = await tx.select().from(knockoutMatchesTable)
        .where(and(
          eq(knockoutMatchesTable.tournamentId, tournament.id),
          or(
            eq(knockoutMatchesTable.homeTeamId, oldId),
            eq(knockoutMatchesTable.awayTeamId, oldId),
            eq(knockoutMatchesTable.winnerId, oldId),
          ),
        ));
      if (groupMatches.some(m => m.homeTeamId === newId || m.awayTeamId === newId) ||
          knockoutMatches.some(m => m.homeTeamId === newId || m.awayTeamId === newId)) {
        throw new Error("REPLACEMENT_SELF_MATCH");
      }
      const allKnockout = await tx.select().from(knockoutMatchesTable)
        .where(eq(knockoutMatchesTable.tournamentId, tournament.id));
      const isDoubleElim = allKnockout.some(m => m.bracket === "winner");
      if (isDoubleElim && knockoutMatches.some(m => m.played || m.winnerId != null || m.homeScore != null || m.awayScore != null)) {
        throw new Error("SCORED_KNOCKOUT");
      }
      if (knockoutMatches.some(m => allKnockout.some(other =>
        other.id !== m.id && other.round === m.round &&
        (other.homeTeamId === newId || other.awayTeamId === newId)))) {
        throw new Error("REPLACEMENT_DUPLICATE_ROUND");
      }

      const groupIds = groupMatches.map(m => m.id);
      const knockoutById = new Map(allKnockout.map(m => [m.id, { ...m }]));
      const changedKnockoutIds = new Set(knockoutMatches.map(m => m.id));
      const roundOrder = ["r32", "r16", "quarter", "semi", "final"]
        .filter(round => allKnockout.some(m => m.round === round));
      const invalidateKnockout = (matchId: number, seen = new Set<number>()) => {
        if (seen.has(matchId)) return;
        seen.add(matchId);
        const match = knockoutById.get(matchId);
        if (!match) return;
        const oldWinner = match.winnerId;
        const oldLoser = match.homeTeamId === oldWinner ? match.awayTeamId : match.homeTeamId;
        const wasPlayed = match.played;
        Object.assign(match, { homeScore: null, awayScore: null, winnerId: null, played: false, startedAt: null });
        changedKnockoutIds.add(match.id);
        if (!wasPlayed) return;

        const roundIndex = roundOrder.indexOf(match.round);
        const nextRound = roundIndex >= 0 ? roundOrder[roundIndex + 1] : undefined;
        const nextMatch = nextRound && allKnockout.find(m =>
          m.round === nextRound && m.matchNumber === Math.ceil(match.matchNumber / 2));
        if (nextMatch && oldWinner != null) {
          const child = knockoutById.get(nextMatch.id)!;
          const slot = match.matchNumber % 2 ? "homeTeamId" : "awayTeamId";
          if (child[slot] === oldWinner) child[slot] = null;
          invalidateKnockout(child.id, seen);
        }
        if (match.round === "semi" && oldWinner != null && oldLoser != null) {
          const third = allKnockout.find(m => m.round === "third_place");
          if (third) {
            const child = knockoutById.get(third.id)!;
            const slot = match.matchNumber % 2 ? "homeTeamId" : "awayTeamId";
            if (child[slot] === oldLoser) child[slot] = null;
            invalidateKnockout(child.id, seen);
          }
        }
      };
      if (!isDoubleElim) {
        for (const match of knockoutMatches) {
          if (match.played || match.winnerId != null || match.homeScore != null || match.awayScore != null) {
            invalidateKnockout(match.id);
          }
        }
      }
      for (const match of knockoutById.values()) {
        if (match.homeTeamId === oldId) { match.homeTeamId = newId; changedKnockoutIds.add(match.id); }
        if (match.awayTeamId === oldId) { match.awayTeamId = newId; changedKnockoutIds.add(match.id); }
      }
      const knockoutIds = [...changedKnockoutIds];
      if (groupIds.length) {
        await tx.update(teamEventRubbersTable)
          .set({ homePlayerIds: [], awayPlayerIds: [], homeScore: null, awayScore: null, games: [], played: false })
          .where(inArray(teamEventRubbersTable.groupMatchId, groupIds));
        await tx.update(matchesTable)
          .set({ homeTeamId: newId, homeScore: null, awayScore: null, played: false, startedAt: null })
          .where(and(inArray(matchesTable.id, groupIds), eq(matchesTable.homeTeamId, oldId)));
        await tx.update(matchesTable)
          .set({ awayTeamId: newId, homeScore: null, awayScore: null, played: false, startedAt: null })
          .where(and(inArray(matchesTable.id, groupIds), eq(matchesTable.awayTeamId, oldId)));
      }
      if (knockoutIds.length) {
        await tx.update(teamEventRubbersTable)
          .set({ homePlayerIds: [], awayPlayerIds: [], homeScore: null, awayScore: null, games: [], played: false })
          .where(inArray(teamEventRubbersTable.knockoutMatchId, knockoutIds));
        await tx.update(teamEventDreambreakersTable)
          .set({ firstTeamId: null, homePlayerIds: [], awayPlayerIds: [], homeScore: null, awayScore: null, played: false })
          .where(inArray(teamEventDreambreakersTable.knockoutMatchId, knockoutIds));
        for (const id of knockoutIds) {
          const match = knockoutById.get(id)!;
          await tx.update(knockoutMatchesTable).set({
            homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId,
            homeScore: match.homeScore, awayScore: match.awayScore,
            winnerId: match.winnerId, played: match.played, startedAt: null,
          }).where(eq(knockoutMatchesTable.id, id));
        }
      }
      await tx.delete(teamsTable).where(eq(teamsTable.id, oldId));
      return {
        oldTeamName: oldTeam.name,
        replacementTeamName: newTeam.name,
        groupFixturesChanged: groupIds.length,
        knockoutFixturesChanged: knockoutIds.length,
        scoresCleared: groupMatches.filter(m => m.played || m.homeScore != null || m.awayScore != null).length +
          allKnockout.filter(m => changedKnockoutIds.has(m.id) &&
            (m.homeScore != null || m.awayScore != null)).length,
      };
    });
    broadcast(tournament.id, {
      type: "fixture_change",
      message: `${result.oldTeamName} was replaced by ${result.replacementTeamName} in ${result.groupFixturesChanged} group and ${result.knockoutFixturesChanged} knockout fixture(s). ${result.scoresCleared} result(s) cleared.`,
    });
    res.json(ReplaceAndDeleteTeamResponse.parse(result));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const messages: Record<string, string> = {
      REPLACEMENT_NOT_IN_GROUP: "Choose an existing replacement team from the same group. Add a new team to the group first if needed.",
      REPLACEMENT_SELF_MATCH: "The replacement already plays against this team. Choose a reserve team that does not appear in its fixtures.",
      REPLACEMENT_DUPLICATE_ROUND: "The replacement already appears in the same knockout round. Choose a different reserve team.",
      SCORED_KNOCKOUT: "This team has a scored knockout fixture. Replacement cannot safely undo knockout advancement; reset the knockout bracket before replacing the team.",
      TEAM_IN_WILDCARD_PLAYOFF: "Reset the third-place wildcard playoff before replacing this team.",
      TEAM_IN_BREAKOUT: "Reset the two breakout knockout brackets before replacing this team.",
    };
    if (messages[reason]) { res.status(409).json({ error: messages[reason] }); return; }
    throw error;
  }
});

router.put("/matches/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateMatchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateMatchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existingMatch] = await db.select().from(matchesTable).where(eq(matchesTable.id, params.data.id));
  if (!existingMatch) { res.status(404).json({ error: "Match not found" }); return; }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, existingMatch.groupId));
  if (group) {
    const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, group.tournamentId));
    if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
    const userId = (req as Request & { userId: string }).userId;
    const admin = await isAdminUser(userId);
    if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
    if (tournament?.status === "completed") { res.status(409).json({ error: "Cannot edit matches in a completed tournament" }); return; }
    if (tournament?.format === "team_event") { res.status(409).json({ error: "Team Event ties must be scored through rubbers" }); return; }
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.homeScore !== undefined) updateData.homeScore = parsed.data.homeScore;
  if (parsed.data.awayScore !== undefined) updateData.awayScore = parsed.data.awayScore;
  if (parsed.data.played !== undefined) {
    updateData.played = parsed.data.played;
    updateData.startedAt = parsed.data.played
      ? (existingMatch.startedAt ?? new Date())
      : null;
  }

  const [match] = await db.update(matchesTable).set(updateData).where(eq(matchesTable.id, params.data.id)).returning();
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  const [enriched] = await enrichMatches([match]);
  // Broadcast update to any SSE spectators watching this tournament
  if (group) broadcast(group.tournamentId);
  res.json(UpdateMatchResponse.parse(enriched));
});

router.post("/matches/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateMatchParams.safeParse({ id: req.params.id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [existingMatch] = await db.select().from(matchesTable).where(eq(matchesTable.id, params.data.id));
  if (!existingMatch) { res.status(404).json({ error: "Match not found" }); return; }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, existingMatch.groupId));
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, group.tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot start matches in a completed tournament" }); return; }
  if (existingMatch.played) { res.status(409).json({ error: "Match is already completed" }); return; }

  const [match] = await db.update(matchesTable)
    .set({ startedAt: existingMatch.startedAt ?? new Date() })
    .where(eq(matchesTable.id, params.data.id))
    .returning();
  const [enriched] = await enrichMatches([match]);
  if (group) broadcast(group.tournamentId);
  res.json(UpdateMatchResponse.parse(enriched));
});

router.delete("/matches/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteMatchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [match] = await db.select().from(matchesTable).where(eq(matchesTable.id, params.data.id));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, match.groupId));
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, group.tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot delete matches from a completed tournament" }); return; }
  await db.delete(matchesTable).where(eq(matchesTable.id, params.data.id));
  res.sendStatus(204);
});

/* ── Knockout bracket ────────────────────────────────── */

const ROUNDS_ORDER = ['r32', 'r16', 'quarter', 'semi', 'final'] as const;
type RoundLabel = typeof ROUNDS_ORDER[number];

function bracketRounds(bracketSize: number): RoundLabel[] {
  if (bracketSize === 2) return ['final'];
  if (bracketSize === 4) return ['semi', 'final'];
  if (bracketSize === 8) return ['quarter', 'semi', 'final'];
  if (bracketSize === 16) return ['r16', 'quarter', 'semi', 'final'];
  return ['r32', 'r16', 'quarter', 'semi', 'final'];
}

function nextRound(round: RoundLabel): RoundLabel | null {
  const idx = ROUNDS_ORDER.indexOf(round);
  if (idx < 0 || idx === ROUNDS_ORDER.length - 1) return null;
  return ROUNDS_ORDER[idx + 1];
}

type TiebreakerKey = "goal_difference" | "goals_for" | "goals_against" | "head_to_head";
const DEFAULT_TIEBREAKER_ORDER: TiebreakerKey[] = ["goal_difference", "goals_for", "goals_against", "head_to_head"];

function parseTiebreakerOrder(raw: string | null | undefined): TiebreakerKey[] {
  if (!raw) return DEFAULT_TIEBREAKER_ORDER;
  const valid = new Set<TiebreakerKey>(["goal_difference", "goals_for", "goals_against", "head_to_head"]);
  const parsed = raw.split(",").map((s) => s.trim()) as TiebreakerKey[];
  return parsed.filter((k) => valid.has(k)).length > 0 ? parsed.filter((k) => valid.has(k)) : DEFAULT_TIEBREAKER_ORDER;
}

/** Shared standings comparator — identical tiebreak rules used by both the /standings endpoint and qualifier seeding.
 *  First by points desc, then by the tiebreaker order configured on the tournament.
 *  Available tiebreakers: goal_difference, goals_for, goals_against, head_to_head.
 */
function makeStandingsComparator(
  playedGroupMatches: Array<typeof matchesTable.$inferSelect>,
  tiebreakerOrder?: string | null,
): (
  a: { teamId: number; pts: number; gf: number; ga: number; groupId: number },
  b: { teamId: number; pts: number; gf: number; ga: number; groupId: number },
) => number {
  const order = parseTiebreakerOrder(tiebreakerOrder);
  return (a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    for (const key of order) {
      if (key === "goal_difference") {
        const aDiff = a.gf - a.ga;
        const bDiff = b.gf - b.ga;
        if (bDiff !== aDiff) return bDiff - aDiff;
      } else if (key === "goals_for") {
        if (b.gf !== a.gf) return b.gf - a.gf;
      } else if (key === "goals_against") {
        if (a.ga !== b.ga) return a.ga - b.ga;
      } else if (key === "head_to_head" && a.groupId === b.groupId) {
        const h2h = playedGroupMatches.find(
          (m) =>
            ((m.homeTeamId === a.teamId && m.awayTeamId === b.teamId) ||
              (m.homeTeamId === b.teamId && m.awayTeamId === a.teamId)) &&
            a.groupId === b.groupId,
        );
        if (h2h) {
          const aWon =
            (h2h.homeTeamId === a.teamId && h2h.homeScore! > h2h.awayScore!) ||
            (h2h.awayTeamId === a.teamId && h2h.awayScore! > h2h.homeScore!);
          if (aWon) return -1;
          const bWon =
            (h2h.homeTeamId === b.teamId && h2h.homeScore! > h2h.awayScore!) ||
            (h2h.awayTeamId === b.teamId && h2h.awayScore! > h2h.homeScore!);
          if (bWon) return 1;
        }
      }
    }
    return 0;
  };
}

/** Return team standings sorted by group then position (1st, 2nd, 3rd...).
 *  Uses the same full tiebreak rules (pts → GF → GA → H2H) as the /standings endpoint. */
export async function getSortedQualifiers(
  tournament: typeof tournamentTable.$inferSelect,
  database: Pick<typeof db, "select"> = db,
): Promise<Array<{ teamId: number; teamName: string; groupIndex: number; position: number }>> {
  const groups = await database
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.tournamentId, tournament.id))
    .orderBy(groupsTable.groupNumber);
  const groupIds = groups.map((g) => g.id);
  if (groupIds.length === 0) return [];

  const teams = await database.select().from(teamsTable).where(inArray(teamsTable.groupId, groupIds));
  const allMatches = await database.select().from(matchesTable).where(inArray(matchesTable.groupId, groupIds));
  const playedMatches = allMatches.filter((m) => m.played && m.homeScore != null && m.awayScore != null);

  type Row = { teamId: number; teamName: string; groupId: number; pts: number; gf: number; ga: number; played: number };
  const map = new Map<number, Row>();
  for (const t of teams) {
    map.set(t.id, { teamId: t.id, teamName: t.name, groupId: t.groupId, pts: 0, gf: 0, ga: 0, played: 0 });
  }
  for (const m of playedMatches) {
    const home = map.get(m.homeTeamId);
    const away = map.get(m.awayTeamId);
    if (!home || !away) continue;
    home.played++;
    away.played++;
    home.gf += m.homeScore!; home.ga += m.awayScore!;
    away.gf += m.awayScore!; away.ga += m.homeScore!;
    if (m.homeScore! > m.awayScore!) { home.pts += 3; }
    else if (m.awayScore! > m.homeScore!) { away.pts += 3; }
  }

  const cmp = makeStandingsComparator(playedMatches, tournament.tiebreakerOrder);
  const qualifiers: Array<{ teamId: number; teamName: string; groupIndex: number; position: number; wildcardRank?: number }> = [];
  const wildcardCandidates: Array<Row & { groupIndex: number; position: number }> = [];
  const limit = tournament.qualifiersPerGroup ?? 1;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const groupTeams = [...map.values()]
      .filter((r) => r.groupId === group.id)
      .sort(cmp);
    for (let pos = 0; pos < Math.min(limit, groupTeams.length); pos++) {
      qualifiers.push({ teamId: groupTeams[pos].teamId, teamName: groupTeams[pos].teamName, groupIndex: gi, position: pos });
    }
    for (let position = limit; position < groupTeams.length; position++) {
      wildcardCandidates.push({ ...groupTeams[position], groupIndex: gi, position });
    }
  }
  wildcardCandidates
    .sort((a, b) => compareWildcardCandidates(
      a,
      b,
      tournament.wildcardRankingMethod ?? "points",
      parseTiebreakerOrder(tournament.tiebreakerOrder),
    ))
    .slice(0, tournament.wildcardQualifiers)
    .forEach((team, wildcardRank) => qualifiers.push({
      teamId: team.teamId,
      teamName: team.teamName,
      groupIndex: team.groupIndex,
      position: team.position,
      wildcardRank,
    }));
  // In PPG mode, keep the comparative ranking of additional qualifiers in the draw.
  qualifiers.sort((a, b) => a.position - b.position
    || (tournament.wildcardRankingMethod === "ppg"
      ? (a.wildcardRank ?? -1) - (b.wildcardRank ?? -1)
      : 0)
    || a.groupIndex - b.groupIndex);
  return qualifiers;
}

export async function getWildcardPlayoffState(tournamentId: number, database: Pick<typeof db, "select"> = db) {
  const matches = await database.select().from(wildcardPlayoffMatchesTable)
    .where(eq(wildcardPlayoffMatchesTable.tournamentId, tournamentId))
    .orderBy(wildcardPlayoffMatchesTable.gameNumber);
  const teamIds = [...new Set(matches.flatMap((match) => [match.homeTeamId, match.awayTeamId]))];
  const teams = teamIds.length > 0
    ? await database.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))
    : [];
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const result = calculateWildcardPlayoffStandings(matches, teams);
  const enrichedMatches = matches.map((match) => ({
    ...match,
    homeTeamName: teamNames.get(match.homeTeamId) ?? "Unknown team",
    awayTeamName: teamNames.get(match.awayTeamId) ?? "Unknown team",
  }));
  return {
    matches: enrichedMatches,
    ...result,
  };
}

export async function getThirdPlaceTeams(tournament: typeof tournamentTable.$inferSelect, database: Pick<typeof db, "select"> = db) {
  const groups = await database.select().from(groupsTable)
    .where(eq(groupsTable.tournamentId, tournament.id))
    .orderBy(groupsTable.groupNumber);
  const groupIds = groups.map((group) => group.id);
  if (groupIds.length === 0) return { groups, candidates: [] as Array<{ teamId: number; teamName: string }> };
  const teams = await database.select().from(teamsTable).where(inArray(teamsTable.groupId, groupIds));
  const groupMatches = await database.select().from(matchesTable).where(inArray(matchesTable.groupId, groupIds));
  const playedMatches = groupMatches.filter((match) => match.played && match.homeScore != null && match.awayScore != null);
  const compare = makeStandingsComparator(playedMatches, tournament.tiebreakerOrder);
  const candidates = selectThirdPlaceCandidates(groups, teams, playedMatches, compare);
  return { groups, candidates };
}

router.get("/tournaments/:id/wildcard-playoff", async (req, res): Promise<void> => {
  const params = GetWildcardPlayoffParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [tournament] = await db.select({ id: tournamentTable.id })
    .from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  res.json(GetWildcardPlayoffResponse.parse(await getWildcardPlayoffState(params.data.id)));
});

router.post("/tournaments/:id/wildcard-playoff", requireAuth, async (req, res): Promise<void> => {
  const params = StartWildcardPlayoffParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  const breakout = await db.query.breakoutKnockoutsTable.findFirst({
    where: eq(breakoutKnockoutsTable.tournamentId, tournament.id),
  });
  if ((tournament.format !== "group_knockout" && !(breakout && tournament.format === "round_robin")) || tournament.wildcardSelectionMethod !== "round_robin") {
    res.status(409).json({ error: "Wildcard playoff requires group_knockout format and round_robin wildcard selection" }); return;
  }
  if (breakout?.seeds.length) { res.status(409).json({ error: "Reset the breakout brackets before changing the wildcard playoff" }); return; }
  if (tournament.qualifiersPerGroup !== 2 || tournament.wildcardQualifiers !== 2) {
    res.status(409).json({ error: "Wildcard playoff requires two qualifiers per group and two wildcard qualifiers" }); return;
  }
  const { groups, candidates } = await getThirdPlaceTeams(tournament);
  if (groups.length !== 3 || candidates.length !== 3) {
    res.status(409).json({ error: "Wildcard playoff requires exactly three groups with at least three teams each" }); return;
  }
  const groupIds = groups.map((group) => group.id);
  const groupMatches = await db.select().from(matchesTable).where(inArray(matchesTable.groupId, groupIds));
  if (groupMatches.length === 0 || groupMatches.some((match) => !match.played || match.homeScore == null || match.awayScore == null)) {
    res.status(409).json({ error: "All group matches must be played and scored before starting the wildcard playoff" }); return;
  }
  const [existingBracket] = await db.select({ id: knockoutMatchesTable.id })
    .from(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, tournament.id));
  if (existingBracket) { res.status(409).json({ error: "Knockout bracket already generated" }); return; }
  const existingMatches = await db.select({ id: wildcardPlayoffMatchesTable.id })
    .from(wildcardPlayoffMatchesTable).where(eq(wildcardPlayoffMatchesTable.tournamentId, tournament.id));
  if (existingMatches.length > 0) { res.status(409).json({ error: "Wildcard playoff already exists" }); return; }
  const pairs: Array<[number, number]> = [
    [candidates[0].teamId, candidates[1].teamId],
    [candidates[1].teamId, candidates[2].teamId],
    [candidates[2].teamId, candidates[0].teamId],
  ];
  await db.insert(wildcardPlayoffMatchesTable).values(pairs.map(([homeTeamId, awayTeamId], index) => ({
    tournamentId: tournament.id, gameNumber: index + 1, homeTeamId, awayTeamId, played: false,
  })));
  broadcast(tournament.id);
  res.status(201).json(StartWildcardPlayoffResponse.parse(await getWildcardPlayoffState(tournament.id)));
});

router.put("/tournaments/:id/wildcard-playoff/:matchId", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateWildcardPlayoffMatchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = UpdateWildcardPlayoffMatchBody.safeParse(req.body);
  if (!body.success || !Number.isInteger(body.data?.homeScore) || !Number.isInteger(body.data?.awayScore)) {
    res.status(400).json({ error: body.success ? "Scores must be nonnegative integers" : body.error.message }); return;
  }
  if (body.data.homeScore === body.data.awayScore) { res.status(400).json({ error: "Wildcard playoff matches cannot end in a draw" }); return; }
  const [match] = await db.select().from(wildcardPlayoffMatchesTable).where(and(
    eq(wildcardPlayoffMatchesTable.id, params.data.matchId),
    eq(wildcardPlayoffMatchesTable.tournamentId, params.data.id),
  ));
  if (!match) { res.status(404).json({ error: "Wildcard playoff match not found" }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  const [bracket] = await db.select({ id: knockoutMatchesTable.id })
    .from(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, tournament.id));
  if (bracket) { res.status(409).json({ error: "Wildcard playoff scores cannot be changed after knockout generation" }); return; }
  const breakout = await db.query.breakoutKnockoutsTable.findFirst({ where: eq(breakoutKnockoutsTable.tournamentId, tournament.id) });
  if (breakout?.seeds.length) { res.status(409).json({ error: "Reset the breakout brackets before changing wildcard playoff scores" }); return; }
  await db.update(wildcardPlayoffMatchesTable)
    .set({ homeScore: body.data.homeScore, awayScore: body.data.awayScore, played: true })
    .where(eq(wildcardPlayoffMatchesTable.id, match.id));
  broadcast(tournament.id);
  res.json(UpdateWildcardPlayoffMatchResponse.parse(await getWildcardPlayoffState(tournament.id)));
});

router.delete("/tournaments/:id/wildcard-playoff", requireAuth, async (req, res): Promise<void> => {
  const params = ResetWildcardPlayoffParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  const [bracket] = await db.select({ id: knockoutMatchesTable.id })
    .from(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, tournament.id));
  if (bracket) { res.status(409).json({ error: "Wildcard playoff cannot be reset after knockout generation" }); return; }
  const breakout = await db.query.breakoutKnockoutsTable.findFirst({ where: eq(breakoutKnockoutsTable.tournamentId, tournament.id) });
  if (breakout?.seeds.length) { res.status(409).json({ error: "Reset the breakout brackets before resetting the wildcard playoff" }); return; }
  await db.delete(wildcardPlayoffMatchesTable)
    .where(eq(wildcardPlayoffMatchesTable.tournamentId, tournament.id));
  broadcast(tournament.id);
  res.sendStatus(204);
});

async function enrichKnockoutMatches(
  rows: Array<typeof knockoutMatchesTable.$inferSelect>,
): Promise<Array<typeof knockoutMatchesTable.$inferSelect & { homeTeamName: string | null; awayTeamName: string | null; winnerName: string | null }>> {
  if (rows.length === 0) return [];
  const teamIds = [...new Set([
    ...rows.filter((r) => r.homeTeamId != null).map((r) => r.homeTeamId!),
    ...rows.filter((r) => r.awayTeamId != null).map((r) => r.awayTeamId!),
    ...rows.filter((r) => r.winnerId != null).map((r) => r.winnerId!),
  ])];
  const teamsById = teamIds.length
    ? Object.fromEntries((await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))).map((t) => [t.id, t]))
    : {};
  return rows.map((r) => ({
    ...r,
    homeTeamName: r.homeTeamId != null ? (teamsById[r.homeTeamId]?.name ?? null) : null,
    awayTeamName: r.awayTeamId != null ? (teamsById[r.awayTeamId]?.name ?? null) : null,
    winnerName: r.winnerId != null ? (teamsById[r.winnerId]?.name ?? null) : null,
  }));
}

/** Process byes in a single-elimination bracket across all rounds (handles cascading).
 *  A match is eligible for bye processing if all its source matches in the previous round
 *  are already marked played (either as real matches later or as byes now). */
async function processSingleElimByes(
  tournamentId: number,
  insertedByRound: Map<RoundLabel, Array<typeof knockoutMatchesTable.$inferSelect>>,
  rounds: RoundLabel[],
): Promise<void> {
  for (let ri = 0; ri < rounds.length; ri++) {
    const round = rounds[ri];
    const roundMatches = insertedByRound.get(round)!;
    const nxtRound = ri < rounds.length - 1 ? rounds[ri + 1] : null;
    const prevRoundMatches = ri > 0 ? insertedByRound.get(rounds[ri - 1])! : null;

    for (const match of roundMatches) {
      if (match.played) continue;

      // A slot is "finalized" if its source match (previous round) is already played.
      // Round 0 (first round) always has finalized slots — they came from the seeding.
      let homeFinalized = true;
      let awayFinalized = true;
      if (prevRoundMatches) {
        const homeSrc = prevRoundMatches.find((m) => m.matchNumber === 2 * match.matchNumber - 1);
        const awaySrc = prevRoundMatches.find((m) => m.matchNumber === 2 * match.matchNumber);
        homeFinalized = !homeSrc || homeSrc.played;
        awayFinalized = !awaySrc || awaySrc.played;
      }
      if (!homeFinalized || !awayFinalized) continue; // Still waiting on a real match result

      const hasBye = match.homeTeamId === null || match.awayTeamId === null;
      const nonByeId = match.homeTeamId ?? match.awayTeamId;

      if (hasBye && nonByeId != null) {
        // One real team, one finalized-null opponent → advance the real team
        if (nxtRound) {
          const nextMatchNum = Math.ceil(match.matchNumber / 2);
          const slot = match.matchNumber % 2 !== 0 ? "homeTeamId" : "awayTeamId";
          await db.update(knockoutMatchesTable)
            .set({ [slot]: nonByeId })
            .where(and(
              eq(knockoutMatchesTable.tournamentId, tournamentId),
              eq(knockoutMatchesTable.round, nxtRound),
              eq(knockoutMatchesTable.matchNumber, nextMatchNum),
            ));
          // Mutate in-memory so the next-round loop sees the updated slots for cascading
          const nxtMatches = insertedByRound.get(nxtRound)!;
          const nm = nxtMatches.find((m) => m.matchNumber === nextMatchNum);
          if (nm) { if (slot === "homeTeamId") nm.homeTeamId = nonByeId; else nm.awayTeamId = nonByeId; }
        } else {
          // Only-round final with one bye side → walkover
          await db.update(tournamentTable).set({ status: "completed" }).where(eq(tournamentTable.id, tournamentId));
        }
        await db.update(knockoutMatchesTable)
          .set({ winnerId: nonByeId, played: true })
          .where(eq(knockoutMatchesTable.id, match.id));
        match.played = true;
        match.winnerId = nonByeId;
      } else if (match.homeTeamId === null && match.awayTeamId === null) {
        // Both slots are finalized-null (double bye) → mark played with no winner
        await db.update(knockoutMatchesTable)
          .set({ played: true })
          .where(eq(knockoutMatchesTable.id, match.id));
        match.played = true;
      }
    }
  }
}

/** Process a potential single-bye cascade in a LB match after one of its slots was just filled.
 *  If the other slot's source has already been played and produced no team (permanent null),
 *  the filled team advances as a bye winner to the next LB round (or GF). */
async function processLBByeCascade(
  tournamentId: number,
  lbMatchId: number,
  lbRoundNum: number,
  lbMatchNum: number,
): Promise<void> {
  const [m] = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, lbMatchId));
  if (!m || m.played) return;

  const home = m.homeTeamId;
  const away = m.awayTeamId;
  // Both slots filled → real match; or both null → nothing to do here
  if ((home !== null) === (away !== null)) return;

  const nullSlot = home !== null ? 'away' : 'home';
  const winnerId = home ?? away;
  if (!winnerId) return;

  // Determine if the null slot is permanently null (its source match is already played)
  let sourceIsPlayed = false;
  if (lbRoundNum === 1) {
    // LB R1: slots come from WB R1 matches
    const wbMatchNum = nullSlot === 'home' ? 2 * lbMatchNum - 1 : 2 * lbMatchNum;
    const [src] = await db.select({ played: knockoutMatchesTable.played })
      .from(knockoutMatchesTable)
      .where(and(eq(knockoutMatchesTable.tournamentId, tournamentId), eq(knockoutMatchesTable.round, 'w1'), eq(knockoutMatchesTable.matchNumber, wbMatchNum)));
    sourceIsPlayed = src?.played ?? false;
  } else if (lbRoundNum % 2 === 0 && nullSlot === 'away') {
    // Even LB round: away slot from WB R(lbRound/2 + 1)
    const wbK = lbRoundNum / 2 + 1;
    const [src] = await db.select({ played: knockoutMatchesTable.played })
      .from(knockoutMatchesTable)
      .where(and(eq(knockoutMatchesTable.tournamentId, tournamentId), eq(knockoutMatchesTable.round, `w${wbK}`), eq(knockoutMatchesTable.matchNumber, lbMatchNum)));
    sourceIsPlayed = src?.played ?? false;
  } else if (lbRoundNum % 2 === 0 && nullSlot === 'home') {
    // Even LB round: home slot from LB R(lbRound-1) same match number
    const [src] = await db.select({ played: knockoutMatchesTable.played })
      .from(knockoutMatchesTable)
      .where(and(eq(knockoutMatchesTable.tournamentId, tournamentId), eq(knockoutMatchesTable.round, `l${lbRoundNum - 1}`), eq(knockoutMatchesTable.matchNumber, lbMatchNum)));
    sourceIsPlayed = src?.played ?? false;
  } else {
    // Odd consolidation round (≥3): null slot from LB R(lbRound-1) partner match
    const partnerNum = nullSlot === 'home' ? 2 * lbMatchNum - 1 : 2 * lbMatchNum;
    const [src] = await db.select({ played: knockoutMatchesTable.played })
      .from(knockoutMatchesTable)
      .where(and(eq(knockoutMatchesTable.tournamentId, tournamentId), eq(knockoutMatchesTable.round, `l${lbRoundNum - 1}`), eq(knockoutMatchesTable.matchNumber, partnerNum)));
    sourceIsPlayed = src?.played ?? false;
  }

  if (!sourceIsPlayed) return; // Source still pending, no cascade

  // Permanently null → single bye: mark played and advance
  await db.update(knockoutMatchesTable).set({ played: true, winnerId }).where(eq(knockoutMatchesTable.id, lbMatchId));

  const nextLBLabel = `l${lbRoundNum + 1}`;
  const [nextLBMatches, currentLBRows] = await Promise.all([
    db.select().from(knockoutMatchesTable).where(and(eq(knockoutMatchesTable.tournamentId, tournamentId), eq(knockoutMatchesTable.round, nextLBLabel))),
    db.select({ id: knockoutMatchesTable.id }).from(knockoutMatchesTable).where(and(eq(knockoutMatchesTable.tournamentId, tournamentId), eq(knockoutMatchesTable.round, `l${lbRoundNum}`))),
  ]);

  if (nextLBMatches.length > 0) {
    const currCount = currentLBRows.length;
    const nextCount = nextLBMatches.length;
    let targetMatchNum: number;
    let targetSlot: string;
    if (nextCount === currCount) {
      targetMatchNum = lbMatchNum; targetSlot = 'homeTeamId';
    } else {
      targetMatchNum = Math.ceil(lbMatchNum / 2);
      targetSlot = lbMatchNum % 2 !== 0 ? 'homeTeamId' : 'awayTeamId';
    }
    const target = nextLBMatches.find((x) => x.matchNumber === targetMatchNum);
    if (target) {
      await db.update(knockoutMatchesTable).set({ [targetSlot]: winnerId }).where(eq(knockoutMatchesTable.id, target.id));
      await processLBByeCascade(tournamentId, target.id, lbRoundNum + 1, targetMatchNum);
    }
  } else {
    // Last LB round: winner → GF away slot
    const [gfMatch] = await db.select().from(knockoutMatchesTable)
      .where(and(eq(knockoutMatchesTable.tournamentId, tournamentId), eq(knockoutMatchesTable.round, 'grand_final')));
    if (gfMatch) await db.update(knockoutMatchesTable).set({ awayTeamId: winnerId }).where(eq(knockoutMatchesTable.id, gfMatch.id));
  }
}

/** Generate a standard double-elimination bracket.
 *
 *  ALL qualifiers enter the Winner Bracket (WB). Losing in WB drops you to the
 *  Loser Bracket (LB). Losing in LB eliminates you (two total losses). The LB
 *  champion meets the WB champion in the Grand Final; if the LB champion wins
 *  a reset match is created (both teams have one loss each).
 *
 *  Bracket structure for wbSize = 2^n:
 *    WB: w1 … wn  (wbSize/2^r matches in WB round r)
 *    LB: l1 … l(2n-2)  (LB round r has wbSize >> (ceil(r/2)+1) matches)
 *    GF: grand_final  (home = WB champion, away = LB champion)
 *
 *  WB loser drop mapping:
 *    WB R1 Mi → LB R1 M(ceil(i/2)), home slot if i odd, away slot if i even
 *    WB Rk (k≥2) Mi → LB R(2*(k-1)) Mi, away slot
 *
 *  LB winner advance:
 *    If next LB round has same match count: same match#, home slot
 *    If next LB round has fewer matches: pairing — ceil(m/2), home if odd, away if even
 */
async function generateDoubleEliminationBracket(
  tournamentId: number,
  qualifiers: number[],
  wbSize: number,
): Promise<void> {
  const n = Math.log2(wbSize); // exact integer since wbSize is a power of 2
  const numLBRounds = 2 * (n - 1);

  // Sequential seeding into WB R1: S1 vs S2, S3 vs S4, …
  const wbSlots: (number | null)[] = [...qualifiers, ...Array(wbSize - qualifiers.length).fill(null)];

  // ── Step 1: Create all LB matches (all null initially) ───────────────────────
  const lbByRound = new Map<number, Array<typeof knockoutMatchesTable.$inferSelect>>();
  for (let r = 1; r <= numLBRounds; r++) {
    const numMatches = wbSize >> (Math.ceil(r / 2) + 1);
    const roundLabel = `l${r}`;
    const matches: Array<typeof knockoutMatchesTable.$inferSelect> = [];
    for (let m = 1; m <= numMatches; m++) {
      const [ins] = await db.insert(knockoutMatchesTable).values({
        tournamentId, round: roundLabel, matchNumber: m,
        homeTeamId: null, awayTeamId: null, played: false, bracket: 'loser',
      }).returning();
      matches.push(ins);
    }
    lbByRound.set(r, matches);
  }

  // ── Step 2: Create Grand Final placeholder ───────────────────────────────────
  const [gf] = await db.insert(knockoutMatchesTable).values({
    tournamentId, round: 'grand_final', matchNumber: 1,
    homeTeamId: null, awayTeamId: null, played: false, bracket: 'grand_final',
  }).returning();

  // ── Step 3: Create WB matches with loserDropsTo links ───────────────────────
  const wbByRound = new Map<number, Array<typeof knockoutMatchesTable.$inferSelect>>();
  for (let i = 1; i <= n; i++) {
    const numMatches = wbSize >> i;
    const roundLabel = `w${i}`;
    // WB R1 → LB R1; WB Rk (k≥2) → LB R(2*(k-1))
    const lbDropRound = i === 1 ? 1 : 2 * (i - 1);
    const lbDropTargets = lbByRound.get(lbDropRound) ?? null;
    const matches: Array<typeof knockoutMatchesTable.$inferSelect> = [];

    for (let m = 1; m <= numMatches; m++) {
      const homeTeamId = i === 1 ? (wbSlots[2 * (m - 1)] ?? null) : null;
      const awayTeamId = i === 1 ? (wbSlots[2 * (m - 1) + 1] ?? null) : null;

      let loserDropsToMatchId: number | null = null;
      let loserDropsToSlot: 'home' | 'away' | null = null;
      if (numLBRounds === 0 && i === 1) {
        // Special case: wbSize=2 (n=1) — no LB rounds at all.
        // The sole WB R1 match's loser drops directly to the Grand Final away slot.
        loserDropsToMatchId = gf.id;
        loserDropsToSlot = 'away';
      } else if (lbDropTargets) {
        if (i === 1) {
          // WB R1: pair 2 losers per LB R1 match; home slot for odd match#, away for even
          const lbIdx = Math.floor((m - 1) / 2);
          loserDropsToMatchId = lbDropTargets[lbIdx]?.id ?? null;
          loserDropsToSlot = loserDropsToMatchId ? (m % 2 !== 0 ? 'home' : 'away') : null;
        } else {
          // WB Rk (k≥2): 1-to-1 mapping, away slot
          loserDropsToMatchId = lbDropTargets[m - 1]?.id ?? null;
          loserDropsToSlot = loserDropsToMatchId ? 'away' : null;
        }
      }

      const [ins] = await db.insert(knockoutMatchesTable).values({
        tournamentId, round: roundLabel, matchNumber: m,
        homeTeamId, awayTeamId, played: false, bracket: 'winner',
        loserDropsToMatchId, loserDropsToSlot,
      }).returning();
      matches.push(ins);
    }
    wbByRound.set(i, matches);
  }

  // ── Step 4: Cascade byes through WB and LB ───────────────────────────────────
  // Iteratively process any match where both slots are "determined" (real or permanently null)
  // and the match is a bye (single or double). Continue until stable.
  let progress = true;
  while (progress) {
    progress = false;

    // WB bye processing
    for (let i = 1; i <= n; i++) {
      const wbMatches = wbByRound.get(i)!;
      for (const match of wbMatches) {
        if (match.played) continue;
        // For rounds beyond R1, all feeder matches must be resolved first
        if (i > 1) {
          const prev = wbByRound.get(i - 1)!;
          const hSrc = prev.find((m) => m.matchNumber === 2 * match.matchNumber - 1);
          const aSrc = prev.find((m) => m.matchNumber === 2 * match.matchNumber);
          if ((hSrc && !hSrc.played) || (aSrc && !aSrc.played)) continue;
        }

        const home = match.homeTeamId;
        const away = match.awayTeamId;
        const nonByeId = home ?? away;

        if (home === null && away === null) {
          // Double bye — mark played, no loser drops to LB
          await db.update(knockoutMatchesTable).set({ played: true }).where(eq(knockoutMatchesTable.id, match.id));
          match.played = true;
          progress = true;
        } else if (home === null || away === null) {
          // Single bye — advance winner, no loser to LB (WB byes have no real opponent)
          if (i < n) {
            const nextMatchNum = Math.ceil(match.matchNumber / 2);
            const slot = match.matchNumber % 2 !== 0 ? 'homeTeamId' : 'awayTeamId';
            const nextWB = wbByRound.get(i + 1)!;
            const nm = nextWB.find((x) => x.matchNumber === nextMatchNum);
            if (nm) {
              await db.update(knockoutMatchesTable).set({ [slot]: nonByeId }).where(eq(knockoutMatchesTable.id, nm.id));
              if (slot === 'homeTeamId') nm.homeTeamId = nonByeId; else nm.awayTeamId = nonByeId;
            }
          } else {
            // WB Final single bye → winner goes to GF home
            await db.update(knockoutMatchesTable).set({ homeTeamId: nonByeId }).where(eq(knockoutMatchesTable.id, gf.id));
          }
          await db.update(knockoutMatchesTable).set({ played: true, winnerId: nonByeId }).where(eq(knockoutMatchesTable.id, match.id));
          match.played = true;
          match.winnerId = nonByeId;
          progress = true;
        }
      }
    }

    // LB double-bye processing: mark played if both slots are permanently null
    for (let r = 1; r <= numLBRounds; r++) {
      const lbMatches = lbByRound.get(r) ?? [];
      for (const match of lbMatches) {
        if (match.played) continue;
        if (match.homeTeamId !== null || match.awayTeamId !== null) continue;

        // Determine if both source slots are permanently null
        let homeSrcDone = false;
        let awaySrcDone = false;

        if (r === 1) {
          const wb1 = wbByRound.get(1)!;
          const hm = wb1.find((x) => x.matchNumber === 2 * match.matchNumber - 1);
          const aw = wb1.find((x) => x.matchNumber === 2 * match.matchNumber);
          homeSrcDone = !hm || hm.played;
          awaySrcDone = !aw || aw.played;
        } else if (r % 2 === 0) {
          // Even round: home from LB R(r-1), away from WB R(r/2+1)
          const prevLB = lbByRound.get(r - 1) ?? [];
          const hmLB = prevLB.find((x) => x.matchNumber === match.matchNumber);
          const wbK = r / 2 + 1;
          const wbRound = wbByRound.get(wbK) ?? [];
          const awWB = wbRound.find((x) => x.matchNumber === match.matchNumber);
          homeSrcDone = !hmLB || hmLB.played;
          awaySrcDone = !awWB || awWB.played;
        } else {
          // Odd consolidation (r≥3): both from LB R(r-1)
          const prevLB = lbByRound.get(r - 1) ?? [];
          const hmLB = prevLB.find((x) => x.matchNumber === 2 * match.matchNumber - 1);
          const awLB = prevLB.find((x) => x.matchNumber === 2 * match.matchNumber);
          homeSrcDone = !hmLB || hmLB.played;
          awaySrcDone = !awLB || awLB.played;
        }

        if (homeSrcDone && awaySrcDone) {
          await db.update(knockoutMatchesTable).set({ played: true }).where(eq(knockoutMatchesTable.id, match.id));
          match.played = true;
          progress = true;
        }
      }
    }
  }
}

// POST /api/tournaments/:id/generate-knockout
router.post("/tournaments/:id/generate-knockout", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid tournament id" }); return; }

  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }

  // Ownership check — must own or co-organize the tournament, or be admin
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }

  if (tournament.format !== "group_knockout") { res.status(409).json({ error: "Tournament is not in group→knockout format" }); return; }
  const breakout = await db.query.breakoutKnockoutsTable.findFirst({
    where: eq(breakoutKnockoutsTable.tournamentId, id),
  });
  if (breakout) { res.status(409).json({ error: "Two breakout knockouts are enabled. Generate both from the breakout knockout panel." }); return; }

  const knockoutFormat = tournament.knockoutFormat ?? 'single';

  const groupIds = await getGroupIdsForTournament(id);
  if (groupIds.length === 0) { res.status(409).json({ error: "No groups exist — generate the tournament first" }); return; }

  const body = req.body as { qualifierTeamIds?: unknown; seeds?: unknown };

  // ── Fully manual seeding via seeds[] ──────────────────────────────────────
  // seeds is an array of (teamId | null) with length = a power of 2.
  // null entries are explicit bye slots — the matched team auto-advances.
  const rawSeeds = body?.seeds;
  if (rawSeeds !== undefined) {
    if (!Array.isArray(rawSeeds) || rawSeeds.some((x) => x !== null && (typeof x !== "number" || !Number.isInteger(x)))) {
      res.status(400).json({ error: "seeds must be an array of integers or nulls" }); return;
    }
    let seeds = rawSeeds as (number | null)[];
    if (knockoutFormat === "top6") {
      const ranked = seeds.filter((teamId): teamId is number => teamId !== null);
      if ((seeds.length !== 6 && seeds.length !== 8) || ranked.length !== 6 || new Set(ranked).size !== 6) {
        res.status(400).json({ error: "Top 6 Playoff requires exactly six distinct ranked teams; semifinal byes are placed automatically." }); return;
      }
      seeds = topSixSlots(ranked);
    }
    const sz = seeds.length;
    if (sz < 2 || sz > 32 || (sz & (sz - 1)) !== 0) {
      res.status(400).json({ error: "seeds length must be a power of 2 between 2 and 32" }); return;
    }
    const teamCount = seeds.filter((x) => x !== null).length;
    if (teamCount < 2) { res.status(400).json({ error: "At least 2 non-bye seeds are required" }); return; }

    // Validate all non-null IDs belong to this tournament
    const nonNullIds = seeds.filter((x): x is number => x !== null);
    if (new Set(nonNullIds).size !== nonNullIds.length) {
      res.status(400).json({ error: "Each team may appear only once in seeds" }); return;
    }
    const tournamentTeams = await db.select().from(teamsTable).where(inArray(teamsTable.groupId, groupIds));
    const validIds = new Set(tournamentTeams.map((t) => t.id));
    const invalid = nonNullIds.filter((tid) => !validIds.has(tid));
    if (invalid.length > 0) { res.status(400).json({ error: `Team ID(s) ${invalid.join(", ")} do not belong to this tournament` }); return; }

    const existing = await db.select({ id: knockoutMatchesTable.id })
      .from(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, id));
    if (existing.length > 0) { res.status(409).json({ error: "Knockout bracket already generated" }); return; }

    if (knockoutFormat === 'double') {
      await generateDoubleEliminationBracket(id, seeds.filter((x): x is number => x !== null), sz);
    } else {
      const rounds = bracketRounds(sz);
      const firstRound = rounds[0];
      const numFirstRoundMatches = sz / 2;
      const insertedByRound = new Map<RoundLabel, Array<typeof knockoutMatchesTable.$inferSelect>>();
      for (const round of rounds) {
        const numMatches = round === firstRound ? numFirstRoundMatches : (insertedByRound.get(rounds[rounds.indexOf(round) - 1])!.length / 2);
        const matches: Array<typeof knockoutMatchesTable.$inferSelect> = [];
        for (let m = 1; m <= numMatches; m++) {
          const homeTeamId = round === firstRound ? (seeds[2 * (m - 1)] ?? null) : null;
          const awayTeamId = round === firstRound ? (seeds[2 * (m - 1) + 1] ?? null) : null;
          const [inserted] = await db.insert(knockoutMatchesTable).values({
            tournamentId: id, round, matchNumber: m, homeTeamId, awayTeamId, played: false,
          }).returning();
          matches.push(inserted);
        }
        insertedByRound.set(round, matches);
      }
      if (tournament.thirdPlacePlayoffEnabled && sz >= 4) {
        await db.insert(knockoutMatchesTable).values({
          tournamentId: id, round: "third_place", matchNumber: 1, played: false,
        });
      }
      await processSingleElimByes(id, insertedByRound, rounds);
    }

    const allInserted = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, id));
    const enriched = await enrichKnockoutMatches(allInserted);
    res.status(201).json(enriched);
    return;
  }

  // ── Legacy: qualifierTeamIds or auto-computed from standings ──────────────
  const bodyQualifierIds = body?.qualifierTeamIds;
  if (bodyQualifierIds !== undefined && (!Array.isArray(bodyQualifierIds)
    || bodyQualifierIds.some((x) => !Number.isInteger(x)))) {
    res.status(400).json({ error: "qualifierTeamIds must be an array of integer team IDs" }); return;
  }
  const manualQualifiers = bodyQualifierIds === undefined ? null : bodyQualifierIds as number[];
  if (manualQualifiers && new Set(manualQualifiers).size !== manualQualifiers.length) {
    res.status(400).json({ error: "qualifierTeamIds must contain distinct team IDs" }); return;
  }

  if (!manualQualifiers) {
    // Auto mode: require all group matches to be played
    if (!tournament.qualifiersPerGroup || tournament.qualifiersPerGroup < 1) {
      res.status(409).json({ error: "Qualifiers per group not configured" }); return;
    }
    const groupMatches = await db.select()
      .from(matchesTable)
      .where(inArray(matchesTable.groupId, groupIds));
    const unplayed = groupMatches
      .filter((match) => !match.played || match.homeScore == null || match.awayScore == null);
    if (unplayed.length > 0) {
      res.status(409).json({ error: `${unplayed.length} group match(es) still unplayed` }); return;
    }
  }

  const existing = await db.select({ id: knockoutMatchesTable.id })
    .from(knockoutMatchesTable)
    .where(eq(knockoutMatchesTable.tournamentId, id));
  if (existing.length > 0) { res.status(409).json({ error: "Knockout bracket already generated" }); return; }

  let qualifiers: Array<{ teamId: number; teamName: string; groupIndex: number; position: number }>;
  if (manualQualifiers) {
    // Validate that these teams belong to this tournament
    if (manualQualifiers.length === 0) { res.status(400).json({ error: "At least 2 teams are required" }); return; }
    const tournamentTeams = await db.select().from(teamsTable).where(inArray(teamsTable.groupId, groupIds));
    const validIds = new Set(tournamentTeams.map((t) => t.id));
    const invalid = manualQualifiers.filter((tid) => !validIds.has(tid));
    if (invalid.length > 0) { res.status(400).json({ error: `Team ID(s) ${invalid.join(", ")} do not belong to this tournament` }); return; }
    // Build qualifiers list preserving the provided order
    qualifiers = manualQualifiers.map((teamId, i) => {
      const team = tournamentTeams.find((t) => t.id === teamId)!;
      return { teamId, teamName: team.name, groupIndex: i, position: i };
    });
  } else {
    qualifiers = await getSortedQualifiers(tournament);
    if (tournament.wildcardSelectionMethod === "round_robin") {
      if (tournament.qualifiersPerGroup !== 2 || tournament.wildcardQualifiers !== 2 || groupIds.length !== 3) {
        res.status(409).json({ error: "Automatic wildcard playoff qualification requires three groups, two qualifiers per group, and two wildcards" }); return;
      }
      const playoff = await getWildcardPlayoffState(id);
      if (!playoff.qualifiedTeamIds) {
        res.status(409).json({
          error: playoff.tieAtCutoff
            ? "Wildcard playoff is tied at the qualification cutoff; provide manual seeds or qualifierTeamIds"
            : "Complete all three wildcard playoff matches before generating the knockout bracket",
        });
        return;
      }
      const currentThirdPlace = await getThirdPlaceTeams(tournament);
      const playoffTeamIds = new Set(playoff.matches.flatMap((match) => [match.homeTeamId, match.awayTeamId]));
      if (currentThirdPlace.candidates.length !== 3 ||
          currentThirdPlace.candidates.some((candidate) => !playoffTeamIds.has(candidate.teamId))) {
        res.status(409).json({ error: "Group standings changed after the playoff began. Reset the third-place playoff before generating the bracket, or select teams manually." });
        return;
      }
      const groupRows = await db.select().from(groupsTable)
        .where(eq(groupsTable.tournamentId, id))
        .orderBy(groupsTable.groupNumber);
      const tournamentTeams = await db.select().from(teamsTable)
        .where(inArray(teamsTable.groupId, groupIds));
      const teamsById = new Map(tournamentTeams.map((team) => [team.id, team]));
      const groupIndexes = new Map(groupRows.map((group, index) => [group.id, index]));
      const playoffQualifiers = playoff.qualifiedTeamIds.map((teamId) => {
        const team = teamsById.get(teamId);
        return team ? {
          teamId,
          teamName: team.name,
          groupIndex: groupIndexes.get(team.groupId) ?? 0,
          position: 2,
        } : null;
      });
      if (playoffQualifiers.some((qualifier) => qualifier === null)) {
        res.status(409).json({ error: "Wildcard playoff contains a team no longer in this tournament" }); return;
      }
      qualifiers = [
        ...qualifiers.filter((qualifier) => qualifier.position < 2),
        ...playoffQualifiers.filter((qualifier): qualifier is NonNullable<typeof qualifier> => qualifier !== null),
      ].sort((a, b) => a.position - b.position
        || (a.position === 2
          ? playoff.qualifiedTeamIds!.indexOf(a.teamId) - playoff.qualifiedTeamIds!.indexOf(b.teamId)
          : a.groupIndex - b.groupIndex));
    }
  }

  const total = qualifiers.length;
  if (total < 2) { res.status(409).json({ error: "Not enough qualifiers to generate a bracket" }); return; }
  if (knockoutFormat === "top6" && total !== 6) {
    res.status(409).json({ error: `Top 6 Playoff requires exactly six qualifiers; currently ${total}. Adjust qualification settings or review the six ranked seeds.` }); return;
  }

  if (knockoutFormat === 'double') {
    // ── Double Elimination: all qualifiers enter the Winner Bracket ────────────
    let wbSize = 2;
    while (wbSize < total) wbSize *= 2;

    if (wbSize > 32) {
      res.status(409).json({ error: `Too many qualifiers (${total}): maximum 32 for double elimination` }); return;
    }

    await generateDoubleEliminationBracket(id, qualifiers.map((q) => q.teamId), wbSize);
  } else {
    // ── Single Elimination ─────────────────────────────────────────────────────
    let bracketSize = 2;
    while (bracketSize < total) bracketSize *= 2;

    if (bracketSize > 32) {
      res.status(409).json({ error: `Too many qualifiers (${total}): maximum 32 supported. Reduce groups or qualifiers per group.` }); return;
    }

    const rounds = bracketRounds(bracketSize);
    const firstRound = rounds[0];
    const numFirstRoundMatches = bracketSize / 2;

    // Sequential seeding: seed 1 vs 2, seed 3 vs 4, etc.
    const slots: (number | null)[] = knockoutFormat === "top6"
      ? topSixSlots(qualifiers.map((qualifier) => qualifier.teamId))
      : Array(bracketSize).fill(null);
    if (knockoutFormat !== "top6") {
      for (let i = 0; i < qualifiers.length; i++) slots[i] = qualifiers[i].teamId;
    }

    const insertedByRound = new Map<RoundLabel, Array<typeof knockoutMatchesTable.$inferSelect>>();
    for (const round of rounds) {
      const numMatches = round === firstRound ? numFirstRoundMatches : (insertedByRound.get(rounds[rounds.indexOf(round) - 1])!.length / 2);
      const matches: Array<typeof knockoutMatchesTable.$inferSelect> = [];
      for (let m = 1; m <= numMatches; m++) {
        const homeTeamId = round === firstRound ? (slots[2 * (m - 1)] ?? null) : null;
        const awayTeamId = round === firstRound ? (slots[2 * (m - 1) + 1] ?? null) : null;
        const [inserted] = await db.insert(knockoutMatchesTable).values({
          tournamentId: id, round, matchNumber: m,
          homeTeamId, awayTeamId, played: false,
        }).returning();
        matches.push(inserted);
      }
      insertedByRound.set(round, matches);
    }
    if (tournament.thirdPlacePlayoffEnabled && bracketSize >= 4) {
      await db.insert(knockoutMatchesTable).values({
        tournamentId: id, round: "third_place", matchNumber: 1, played: false,
      });
    }

    await processSingleElimByes(id, insertedByRound, rounds);
  }

  const allInserted = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.tournamentId, id));
  const enriched = await enrichKnockoutMatches(allInserted);
  res.status(201).json(enriched);
});

// DELETE /api/tournaments/:id/knockout-bracket
router.delete("/tournaments/:id/knockout-bracket", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteKnockoutBracketParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [tournament] = await db
    .select()
    .from(tournamentTable)
    .where(eq(tournamentTable.id, params.data.id));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }

  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (tournament.format !== "group_knockout") {
    res.status(409).json({ error: "Tournament is not in group→knockout format" });
    return;
  }
  if (tournament.status === "completed") {
    res.status(409).json({ error: "Cannot reset the bracket of a completed tournament" });
    return;
  }

  const reset = await db.transaction(async (tx) => {
    // Lock the entire bracket so a score cannot be committed between this
    // check and the delete below.
    await tx.execute(sql`
      select id
      from knockout_matches
      where tournament_id = ${tournament.id}
      for update
    `);
    const scoredMatches = await tx
      .select({ id: knockoutMatchesTable.id })
      .from(knockoutMatchesTable)
      .where(and(
        eq(knockoutMatchesTable.tournamentId, tournament.id),
        or(
          sql`${knockoutMatchesTable.homeScore} is not null`,
          sql`${knockoutMatchesTable.awayScore} is not null`,
        ),
      ));
    if (scoredMatches.length > 0) return false;

    await tx
      .delete(knockoutMatchesTable)
      .where(eq(knockoutMatchesTable.tournamentId, tournament.id));
    return true;
  });
  if (!reset) {
    res.status(409).json({ error: "Reset knockout scores before re-seeding the bracket" });
    return;
  }

  broadcast(tournament.id);
  res.sendStatus(204);
});

/* ── Individual ladder ─────────────────────────────────── */

async function loadLadderTournament(id: number) {
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, id));
  return tournament;
}

async function checkLadderManager(
  tournament: typeof tournamentTable.$inferSelect,
  req: Request,
  res: Response,
): Promise<boolean> {
  if (!["individual_ladder", "americano"].includes(tournament.format)) {
    res.status(409).json({ error: "Tournament is not configured as an individual format" });
    return false;
  }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function ladderCourtCountIsValid(courtCount: number, format?: string): boolean {
  return format === "americano"
    ? courtCount >= 1 && courtCount <= 3
    : courtCount === 2 || courtCount === 3;
}

function minimumLadderPlayers(courtCount: number): number {
  return courtCount === 3 ? 18 : courtCount * 4;
}

function americanoPartnerKey(first: number, second: number): string {
  return [first, second].sort((a, b) => a - b).join(":");
}

router.get("/tournaments/:id/ladder", async (req, res): Promise<void> => {
  const params = ListLadderStateParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tournament = await loadLadderTournament(params.data.id);
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  if (!["individual_ladder", "americano"].includes(tournament.format)) {
    res.status(409).json({ error: "Tournament is not configured as an individual format" });
    return;
  }
  res.json(ListLadderStateResponse.parse(await getLadderState(tournament.id, tournament.courtCount, tournament.format as "individual_ladder" | "americano")));
});

router.put("/tournaments/:id/ladder/participants", requireAuth, async (req, res): Promise<void> => {
  const params = SetLadderParticipantsParams.safeParse(req.params);
  const body = SetLadderParticipantsBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const tournament = await loadLadderTournament(params.data.id);
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  if (!await checkLadderManager(tournament, req, res)) return;
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot edit a completed tournament" }); return; }

  const names = body.data.names.map((name) => name.trim()).filter(Boolean);
  const duplicateNames = new Set<string>();
  const seenNames = new Set<string>();
  for (const name of names) {
    const normalized = name.toLocaleLowerCase();
    if (seenNames.has(normalized)) duplicateNames.add(name);
    seenNames.add(normalized);
  }
  if (names.length !== body.data.names.length || duplicateNames.size > 0) {
    res.status(400).json({
      error: duplicateNames.size > 0
        ? `Player names must be unique: ${[...duplicateNames].join(", ")}`
        : "Player names cannot be blank",
    });
    return;
  }

  const existingGames = await db.select({ id: ladderGamesTable.id })
    .from(ladderGamesTable)
    .where(eq(ladderGamesTable.tournamentId, tournament.id));
  if (existingGames.length > 0) {
    res.status(409).json({ error: "Reset the ladder before changing its player list" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(ladderCourtsTable).where(eq(ladderCourtsTable.tournamentId, tournament.id));
    await tx.delete(ladderParticipantsTable).where(eq(ladderParticipantsTable.tournamentId, tournament.id));
    await tx.insert(ladderParticipantsTable).values(names.map((name, index) => ({
      tournamentId: tournament.id,
      seed: index + 1,
      name,
    })));
  });
  broadcast(tournament.id);
  res.json(SetLadderParticipantsResponse.parse(await getLadderState(tournament.id, tournament.courtCount, tournament.format as "individual_ladder" | "americano")));
});

router.patch("/tournaments/:id/ladder/participants/:participantId/attendance", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateLadderParticipantAttendanceParams.safeParse(req.params);
  const body = UpdateLadderParticipantAttendanceBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const tournament = await loadLadderTournament(params.data.id);
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  if (!await checkLadderManager(tournament, req, res)) return;
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot change attendance for a completed tournament" }); return; }

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select id from tournament where id = ${tournament.id} for update`);
      const [participant] = await tx.select().from(ladderParticipantsTable).where(and(
        eq(ladderParticipantsTable.id, params.data.participantId),
        eq(ladderParticipantsTable.tournamentId, tournament.id),
      ));
      if (!participant) throw new Error("LADDER_PLAYER_MISSING");

      const games = await tx.select().from(ladderGamesTable)
        .where(eq(ladderGamesTable.tournamentId, tournament.id));
      const started = games.length > 0;
      if (started && tournament.format === "americano" && participant.isHere !== body.data.isHere) {
        throw new Error("AMERICANO_ROSTER_LOCKED");
      }
      if (started && !body.data.isHere) throw new Error("LADDER_CANNOT_LEAVE_AFTER_START");

      if (participant.isHere !== body.data.isHere) {
        await tx.update(ladderParticipantsTable)
          .set({ isHere: body.data.isHere })
          .where(eq(ladderParticipantsTable.id, participant.id));
      }

      if (started && body.data.isHere && !participant.isHere) {
        const courts = await tx.select().from(ladderCourtsTable)
          .where(eq(ladderCourtsTable.tournamentId, tournament.id));
        const alreadyAssigned = games.some((game) => [
          game.homePlayerOneId,
          game.homePlayerTwoId,
          game.awayPlayerOneId,
          game.awayPlayerTwoId,
        ].includes(participant.id)) || courts.some((court) => court.queuePlayerIds.includes(participant.id));
        if (!alreadyAssigned) {
          const benchCourtNumber = tournament.courtCount;
          const benchCourt = courts.find((court) => court.courtNumber === benchCourtNumber);
          if (!benchCourt) throw new Error("LADDER_BENCH_MISSING");
          await tx.update(ladderCourtsTable)
            .set({ queuePlayerIds: [...benchCourt.queuePlayerIds, participant.id] })
            .where(eq(ladderCourtsTable.id, benchCourt.id));
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const errors: Record<string, string> = {
      LADDER_PLAYER_MISSING: "Ladder player not found",
      LADDER_CANNOT_LEAVE_AFTER_START: "Players can only be marked absent before the ladder starts",
      LADDER_BENCH_MISSING: "The waiting bench is not ready",
      AMERICANO_ROSTER_LOCKED: "Americano check-in is locked after the first round starts",
    };
    if (errors[message]) {
      res.status(message === "LADDER_PLAYER_MISSING" ? 404 : 409).json({ error: errors[message] });
      return;
    }
    throw error;
  }

  broadcast(tournament.id);
  res.json(UpdateLadderParticipantAttendanceResponse.parse(await getLadderState(tournament.id, tournament.courtCount, tournament.format as "individual_ladder" | "americano")));
});

router.post("/tournaments/:id/ladder/start", requireAuth, async (req, res): Promise<void> => {
  const params = StartLadderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tournament = await loadLadderTournament(params.data.id);
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  if (!await checkLadderManager(tournament, req, res)) return;
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot start a completed tournament" }); return; }
  if (!ladderCourtCountIsValid(tournament.courtCount, tournament.format)) {
    res.status(400).json({ error: tournament.format === "americano" ? "Americano supports 1 to 3 courts" : "Individual Ladder supports exactly 2 or 3 courts" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select id from tournament where id = ${tournament.id} for update`);
      const players = await tx.select().from(ladderParticipantsTable)
        .where(and(
          eq(ladderParticipantsTable.tournamentId, tournament.id),
          eq(ladderParticipantsTable.isHere, true),
        ))
        .orderBy(ladderParticipantsTable.seed, ladderParticipantsTable.id);
      const existingGames = await tx.select({ id: ladderGamesTable.id })
        .from(ladderGamesTable)
        .where(eq(ladderGamesTable.tournamentId, tournament.id));
      if (existingGames.length > 0) throw new Error("LADDER_ALREADY_STARTED");
      if (tournament.format === "americano") {
        if (players.length !== tournament.courtCount * 4) throw new Error("AMERICANO_PLAYER_COUNT");
      } else {
        if (tournament.courtCount === 2 && players.length % 2 !== 0) throw new Error("LADDER_ODD_PLAYER_COUNT");
        if (players.length < minimumLadderPlayers(tournament.courtCount)) throw new Error("LADDER_TOO_FEW_PLAYERS");
      }
      for (const [index, player] of players.entries()) {
        if (player.seed === null) {
          await tx.update(ladderParticipantsTable)
            .set({ seed: index + 1 })
            .where(eq(ladderParticipantsTable.id, player.id));
        }
      }

      const playerIdsByCourt = tournament.format === "americano"
        ? buildAmericanoRound(players.map((player) => player.id), 0)
        : splitAcrossCourts(players.map((player) => player.id), tournament.courtCount);
      if (playerIdsByCourt.some((playerIds) => playerIds.length < 4)) throw new Error("LADDER_UNDERFILLED_COURT");

      await tx.delete(ladderCourtsTable).where(eq(ladderCourtsTable.tournamentId, tournament.id));
      for (let index = 0; index < tournament.courtCount; index++) {
        const courtNumber = index + 1;
        const nextGame = takeNextGame(playerIdsByCourt[index], tournament.format !== "americano");
        if (!nextGame) throw new Error("LADDER_UNDERFILLED_COURT");
        await tx.insert(ladderCourtsTable).values({
          tournamentId: tournament.id,
          courtNumber,
          queuePlayerIds: nextGame.queuePlayerIds,
        });
        await tx.insert(ladderGamesTable).values({
          tournamentId: tournament.id,
          batchNumber: 1,
          courtNumber,
          homePlayerOneId: nextGame.homePlayerOneId,
          homePlayerTwoId: nextGame.homePlayerTwoId,
          awayPlayerOneId: nextGame.awayPlayerOneId,
          awayPlayerTwoId: nextGame.awayPlayerTwoId,
          played: false,
        });
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const errors: Record<string, string> = {
      LADDER_ALREADY_STARTED: "The ladder has already started",
      LADDER_ODD_PLAYER_COUNT: "Individual Ladder needs an even number of players",
      LADDER_TOO_FEW_PLAYERS: `At least ${minimumLadderPlayers(tournament.courtCount)} players must be marked here to start`,
      LADDER_UNDERFILLED_COURT: "Each court needs four players to start",
      AMERICANO_PLAYER_COUNT: `Americano needs exactly ${tournament.courtCount * 4} players marked here for ${tournament.courtCount} courts`,
    };
    if (errors[message]) {
      res.status(message === "LADDER_ALREADY_STARTED" ? 409 : 400).json({ error: errors[message] });
      return;
    }
    throw error;
  }

  broadcast(tournament.id);
  res.json(StartLadderResponse.parse(await getLadderState(tournament.id, tournament.courtCount, tournament.format as "individual_ladder" | "americano")));
});

router.post("/tournaments/:id/ladder/reset", requireAuth, async (req, res): Promise<void> => {
  const params = ResetLadderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tournament = await loadLadderTournament(params.data.id);
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  if (!await checkLadderManager(tournament, req, res)) return;
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot reset a completed tournament" }); return; }

  await db.transaction(async (tx) => {
    await tx.delete(ladderGamesTable).where(eq(ladderGamesTable.tournamentId, tournament.id));
    await tx.delete(ladderCourtsTable).where(eq(ladderCourtsTable.tournamentId, tournament.id));
  });
  broadcast(tournament.id);
  res.json(ResetLadderResponse.parse(await getLadderState(tournament.id, tournament.courtCount, tournament.format as "individual_ladder" | "americano")));
});

router.put("/ladder-games/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateLadderGameParams.safeParse(req.params);
  const body = UpdateLadderGameBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const selectedPlayerIds = [
    body.data.homePlayerOneId,
    body.data.homePlayerTwoId,
    body.data.awayPlayerOneId,
    body.data.awayPlayerTwoId,
  ];
  if (new Set(selectedPlayerIds).size !== selectedPlayerIds.length) {
    res.status(400).json({ error: "Each player can only be selected once" });
    return;
  }

  const [initialGame] = await db.select().from(ladderGamesTable).where(eq(ladderGamesTable.id, params.data.id));
  if (!initialGame) { res.status(404).json({ error: "Ladder game not found" }); return; }
  const tournament = await loadLadderTournament(initialGame.tournamentId);
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  if (!await checkLadderManager(tournament, req, res)) return;
  if (tournament.format !== "americano" && body.data.homeScore === body.data.awayScore) {
    res.status(400).json({ error: "Ladder games cannot end in a draw — a winning pair is required" });
    return;
  }
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot edit a completed tournament" }); return; }
  if (!await playerIdsExist(tournament.id, selectedPlayerIds)) {
    res.status(400).json({ error: "Every selected player must belong to this ladder" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
    // Serialise score submissions for one tournament so the final score in a
    // batch creates exactly one next batch even when two organisers submit at once.
    await tx.execute(sql`select id from tournament where id = ${tournament.id} for update`);
    const [game] = await tx.select().from(ladderGamesTable).where(eq(ladderGamesTable.id, params.data.id));
    if (!game) throw new Error("LADDER_GAME_MISSING");
    if (game.played) throw new Error("LADDER_GAME_ALREADY_PLAYED");
    if (tournament.format === "americano") {
      const presentPlayers = await tx.select({ id: ladderParticipantsTable.id }).from(ladderParticipantsTable)
        .where(and(
          eq(ladderParticipantsTable.tournamentId, tournament.id),
          eq(ladderParticipantsTable.isHere, true),
        ));
      const presentIds = new Set(presentPlayers.map((player) => player.id));
      if (selectedPlayerIds.some((playerId) => !presentIds.has(playerId))) {
        throw new Error("AMERICANO_PLAYER_NOT_PRESENT");
      }
      const previousGames = await tx.select().from(ladderGamesTable)
        .where(eq(ladderGamesTable.tournamentId, tournament.id));
      const alreadyPlayedThisRound = new Set(previousGames
        .filter((previous) => previous.played && previous.batchNumber === game.batchNumber)
        .flatMap((previous) => [
          previous.homePlayerOneId,
          previous.homePlayerTwoId,
          previous.awayPlayerOneId,
          previous.awayPlayerTwoId,
        ]));
      if (selectedPlayerIds.some((playerId) => alreadyPlayedThisRound.has(playerId))) {
        throw new Error("AMERICANO_PLAYER_ALREADY_PLAYED");
      }
      const usedPairs = new Set(previousGames.filter((previous) => previous.played).flatMap((previous) => [
        americanoPartnerKey(previous.homePlayerOneId, previous.homePlayerTwoId),
        americanoPartnerKey(previous.awayPlayerOneId, previous.awayPlayerTwoId),
      ]));
      if (
        usedPairs.has(americanoPartnerKey(body.data.homePlayerOneId, body.data.homePlayerTwoId))
        || usedPairs.has(americanoPartnerKey(body.data.awayPlayerOneId, body.data.awayPlayerTwoId))
      ) {
        throw new Error("AMERICANO_PARTNER_REPEAT");
      }
    }

    await tx.update(ladderGamesTable).set({
      homePlayerOneId: body.data.homePlayerOneId,
      homePlayerTwoId: body.data.homePlayerTwoId,
      awayPlayerOneId: body.data.awayPlayerOneId,
      awayPlayerTwoId: body.data.awayPlayerTwoId,
      homeScore: body.data.homeScore,
      awayScore: body.data.awayScore,
      played: true,
      winnerMovement: tournament.format === "americano" ? null : winnerMovement(game.courtNumber, tournament.courtCount),
      loserMovement: tournament.format === "americano" ? null : loserMovement(game.courtNumber, tournament.courtCount),
      completedAt: new Date(),
    }).where(eq(ladderGamesTable.id, game.id));

    const completedBatch = await tx.select().from(ladderGamesTable).where(and(
      eq(ladderGamesTable.tournamentId, tournament.id),
      eq(ladderGamesTable.batchNumber, game.batchNumber),
    ));
    if (!completedBatch.every((batchGame) => batchGame.played)) return;

    const courts = await tx.select().from(ladderCourtsTable)
      .where(eq(ladderCourtsTable.tournamentId, tournament.id))
      .orderBy(ladderCourtsTable.courtNumber);
    if (tournament.format === "americano") {
      const players = await tx.select().from(ladderParticipantsTable)
        .where(and(
          eq(ladderParticipantsTable.tournamentId, tournament.id),
          eq(ladderParticipantsTable.isHere, true),
        ))
        .orderBy(ladderParticipantsTable.seed, ladderParticipantsTable.id);
      if (game.batchNumber >= players.length - 1) return;
      const playedGames = await tx.select().from(ladderGamesTable)
        .where(eq(ladderGamesTable.tournamentId, tournament.id));
      const usedPartnerPairs = new Set(playedGames.filter((playedGame) => playedGame.played).flatMap((playedGame) => [
        americanoPartnerKey(playedGame.homePlayerOneId, playedGame.homePlayerTwoId),
        americanoPartnerKey(playedGame.awayPlayerOneId, playedGame.awayPlayerTwoId),
      ]));
      const playerIds = players.map((player) => player.id);
      const nextGames = buildAmericanoRoundAvoidingPartners(playerIds, usedPartnerPairs, game.batchNumber);
      const scheduledGames = nextGames.length > 0 ? nextGames : buildAmericanoRound(playerIds, game.batchNumber);
      for (let index = 0; index < scheduledGames.length; index++) {
        const [homePlayerOneId, homePlayerTwoId, awayPlayerOneId, awayPlayerTwoId] = scheduledGames[index];
        await tx.insert(ladderGamesTable).values({
          tournamentId: tournament.id,
          batchNumber: game.batchNumber + 1,
          courtNumber: index + 1,
          homePlayerOneId,
          homePlayerTwoId,
          awayPlayerOneId,
          awayPlayerTwoId,
          played: false,
        });
      }
      return;
    }
    const gamesByCourt = new Map(completedBatch.map((batchGame) => [batchGame.courtNumber, batchGame]));
    const queuesByCourt = new Map(courts.map((court) => [court.courtNumber, court.queuePlayerIds]));
    const nextRound = buildNextLadderRound(tournament.courtCount, queuesByCourt, gamesByCourt);

    for (let courtNumber = 1; courtNumber <= tournament.courtCount; courtNumber++) {
      const nextCourt = nextRound.get(courtNumber);
      const nextGame = takeNextGame(nextCourt?.gamePlayerIds ?? []);
      const queuePlayerIds = nextCourt?.queuePlayerIds ?? [];
      await tx.update(ladderCourtsTable)
        .set({ queuePlayerIds })
        .where(and(
          eq(ladderCourtsTable.tournamentId, tournament.id),
          eq(ladderCourtsTable.courtNumber, courtNumber),
        ));
      if (nextGame) {
        await tx.insert(ladderGamesTable).values({
          tournamentId: tournament.id,
          batchNumber: game.batchNumber + 1,
          courtNumber,
          homePlayerOneId: nextGame.homePlayerOneId,
          homePlayerTwoId: nextGame.homePlayerTwoId,
          awayPlayerOneId: nextGame.awayPlayerOneId,
          awayPlayerTwoId: nextGame.awayPlayerTwoId,
          played: false,
        });
      }
    }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update ladder game";
    if (message === "LADDER_GAME_ALREADY_PLAYED") {
      res.status(409).json({ error: "This ladder game has already been scored" });
      return;
    }
    if (message === "LADDER_GAME_MISSING") {
      res.status(404).json({ error: "Ladder game not found" });
      return;
    }
    if (message === "AMERICANO_PLAYER_NOT_PRESENT") {
      res.status(400).json({ error: "Every selected Americano player must be marked here" });
      return;
    }
    if (message === "AMERICANO_PARTNER_REPEAT") {
      res.status(409).json({ error: "That partnership has already played together; choose a new partner" });
      return;
    }
    if (message === "AMERICANO_PLAYER_ALREADY_PLAYED") {
      res.status(409).json({ error: "A selected player has already played on another court in this round" });
      return;
    }
    throw error;
  }

  broadcast(tournament.id);
  res.json(UpdateLadderGameResponse.parse(await getLadderState(tournament.id, tournament.courtCount, tournament.format as "individual_ladder" | "americano")));
});

// GET /api/tournaments/:id/events — public SSE endpoint for real-time spectator updates
router.get("/tournaments/:id/events", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).end(); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if present
  res.flushHeaders();

  // Send an initial heartbeat so the client knows the connection is live
  res.write("event: connected\ndata: {}\n\n");

  // Keep-alive ping every 25 s so load-balancers/proxies don't close idle connections
  const ping = setInterval(() => {
    res.write(": ping\n\n");
  }, 25_000);

  const unsubscribe = subscribe(id, (notice) => {
    res.write("event: update\ndata: {}\n\n");
    if (notice?.type === "fixture_change") {
      res.write(`event: fixture-change\ndata: ${JSON.stringify(notice)}\n\n`);
    }
  });

  req.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
});

// GET /api/tournaments/:id/knockout-matches — public
router.get("/tournaments/:id/knockout-matches", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid tournament id" }); return; }
  const rows = await db
    .select()
    .from(knockoutMatchesTable)
    .where(eq(knockoutMatchesTable.tournamentId, id))
    .orderBy(knockoutMatchesTable.round, knockoutMatchesTable.matchNumber);
  const enriched = await enrichKnockoutMatches(rows);
  res.json(enriched);
});

// PUT /api/knockout-matches/:id — enter score for a knockout match
router.post("/knockout-matches/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid match id" }); return; }

  const [match] = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, id));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  const [tournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, match.tournamentId));
  if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  const userId = (req as Request & { userId: string }).userId;
  const admin = await isAdminUser(userId);
  if (!await canManageTournament(tournament, userId, admin)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (tournament.status === "completed") { res.status(409).json({ error: "Cannot start matches in a completed tournament" }); return; }
  if (match.played) { res.status(409).json({ error: "Match is already completed" }); return; }
  if (!match.homeTeamId || !match.awayTeamId) { res.status(409).json({ error: "Match participants not yet determined" }); return; }

  const [updated] = await db.update(knockoutMatchesTable)
    .set({ startedAt: match.startedAt ?? new Date() })
    .where(eq(knockoutMatchesTable.id, id))
    .returning();
  const [enriched] = await enrichKnockoutMatches([updated]);
  broadcast(match.tournamentId);
  res.json(enriched);
});

router.put("/knockout-matches/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid match id" }); return; }
  const { homeScore, awayScore } = req.body as { homeScore?: unknown; awayScore?: unknown };
  if (typeof homeScore !== "number" || typeof awayScore !== "number" || homeScore < 0 || awayScore < 0) {
    res.status(400).json({ error: "homeScore and awayScore must be non-negative numbers" }); return;
  }
  if (homeScore === awayScore) {
    res.status(400).json({ error: "Knockout matches cannot end in a draw — one team must score more" }); return;
  }

  const [match] = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, id));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }

  // Ownership check
  const [kTournament] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, match.tournamentId));
  if (!kTournament) { res.status(404).json({ error: "Tournament not found" }); return; }
  if (kTournament.format === "team_event") { res.status(409).json({ error: "Team Event ties must be scored through rubbers" }); return; }
  const kUserId = (req as Request & { userId: string }).userId;
  const kAdmin = await isAdminUser(kUserId);
  if (!await canManageTournament(kTournament, kUserId, kAdmin)) { res.status(403).json({ error: "Forbidden" }); return; }

  // Block edits on completed tournaments
  if (kTournament.status === "completed") {
    res.status(409).json({ error: "Cannot edit matches in a completed tournament" }); return;
  }

  if (!match.homeTeamId || !match.awayTeamId) {
    res.status(409).json({ error: "Match participants not yet determined" }); return;
  }

  const matchBracket = match.bracket; // 'winner' | 'loser' | 'grand_final' | null (single-elim legacy)

  // For single-elim (null bracket): block edits if the downstream match has already been played
  if (!matchBracket) {
    const currentRound = match.round as RoundLabel;
    const nxtRound = nextRound(currentRound);
    if (nxtRound && match.played) {
      const nextMatchNum = Math.ceil(match.matchNumber / 2);
      const [downstream] = await db.select()
        .from(knockoutMatchesTable)
        .where(and(
          eq(knockoutMatchesTable.tournamentId, match.tournamentId),
          eq(knockoutMatchesTable.round, nxtRound),
          eq(knockoutMatchesTable.matchNumber, nextMatchNum),
        ));
      if (downstream?.played) {
        res.status(409).json({ error: "Cannot edit this result — the downstream match has already been played" }); return;
      }
    }
  }

  // For double-elim Winner Bracket: block if the WB winner's next match OR the loser's LB match is already played
  if (matchBracket === 'winner' && match.played) {
    const wbRoundNum = parseInt(match.round.slice(1));
    const nextWBLabel = `w${wbRoundNum + 1}`;
    const nextMatchNum = Math.ceil(match.matchNumber / 2);

    const [nextWBMatch] = await db.select().from(knockoutMatchesTable)
      .where(and(eq(knockoutMatchesTable.tournamentId, match.tournamentId), eq(knockoutMatchesTable.round, nextWBLabel), eq(knockoutMatchesTable.matchNumber, nextMatchNum)));
    if (nextWBMatch?.played) {
      res.status(409).json({ error: "Cannot edit this result — the winner has already played their next Winner Bracket match" }); return;
    }
    if (!nextWBMatch) {
      // WB Final: winner's next destination is the GF
      const [gf] = await db.select().from(knockoutMatchesTable)
        .where(and(eq(knockoutMatchesTable.tournamentId, match.tournamentId), eq(knockoutMatchesTable.round, 'grand_final')));
      if (gf?.played) {
        res.status(409).json({ error: "Cannot edit this result — the Grand Final has already been played" }); return;
      }
    }
    if (match.loserDropsToMatchId) {
      const [lbTarget] = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, match.loserDropsToMatchId));
      if (lbTarget?.played) {
        res.status(409).json({ error: "Cannot edit this result — the eliminated team has already played in the Loser Bracket" }); return;
      }
    }
  }

  // For double-elim Loser Bracket: block if the LB winner's next match (or GF) is already played
  if (matchBracket === 'loser' && match.played) {
    const lbRoundNum = parseInt(match.round.slice(1));
    const nextLBLabel = `l${lbRoundNum + 1}`;
    const [nextLBMatches, currentLBRows] = await Promise.all([
      db.select().from(knockoutMatchesTable).where(and(eq(knockoutMatchesTable.tournamentId, match.tournamentId), eq(knockoutMatchesTable.round, nextLBLabel))),
      db.select({ id: knockoutMatchesTable.id }).from(knockoutMatchesTable).where(and(eq(knockoutMatchesTable.tournamentId, match.tournamentId), eq(knockoutMatchesTable.round, match.round))),
    ]);
    if (nextLBMatches.length > 0) {
      const nextCount = nextLBMatches.length;
      const currCount = currentLBRows.length;
      const targetMatchNum = nextCount === currCount ? match.matchNumber : Math.ceil(match.matchNumber / 2);
      const targetMatch = nextLBMatches.find((m) => m.matchNumber === targetMatchNum);
      if (targetMatch?.played) {
        res.status(409).json({ error: "Cannot edit this result — the winner has already played their next Loser Bracket match" }); return;
      }
    } else {
      const [gf] = await db.select().from(knockoutMatchesTable)
        .where(and(eq(knockoutMatchesTable.tournamentId, match.tournamentId), eq(knockoutMatchesTable.round, 'grand_final')));
      if (gf?.played) {
        res.status(409).json({ error: "Cannot edit this result — the Grand Final has already been played" }); return;
      }
    }
  }

  // For double-elim Grand Final (first GF only): block if a reset match already exists
  if (matchBracket === 'grand_final' && match.round === 'grand_final' && match.played) {
    const [reset] = await db.select().from(knockoutMatchesTable)
      .where(and(eq(knockoutMatchesTable.tournamentId, match.tournamentId), eq(knockoutMatchesTable.round, 'grand_final_reset')));
    if (reset) {
      const errorMsg = reset.played
        ? "Cannot edit the Grand Final — the reset match has already been played"
        : "Cannot edit the Grand Final — a reset match has already been created from this result";
      res.status(409).json({ error: errorMsg }); return;
    }
  }

  const winnerId = homeScore > awayScore ? match.homeTeamId : match.awayTeamId;
  const loserId = winnerId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;

  // Update this match
  const [scoredMatch] = await db.update(knockoutMatchesTable)
    .set({ homeScore, awayScore, played: true, startedAt: match.startedAt ?? new Date(), winnerId })
    .where(eq(knockoutMatchesTable.id, id))
    .returning({ id: knockoutMatchesTable.id });
  if (!scoredMatch) {
    res.status(409).json({ error: "The knockout bracket was reset before this score could be saved" });
    return;
  }

  if (matchBracket === 'winner') {
    // ── Double-elim: Winner Bracket ────────────────────────────────────────────
    const wbRoundNum = parseInt(match.round.slice(1)); // 'w3' → 3
    const nextWBLabel = `w${wbRoundNum + 1}`;
    const nextMatchNum = Math.ceil(match.matchNumber / 2);
    const winnerSlot = match.matchNumber % 2 !== 0 ? "homeTeamId" : "awayTeamId";

    // Try to advance winner to next WB round
    const [nextWBMatch] = await db.select()
      .from(knockoutMatchesTable)
      .where(and(
        eq(knockoutMatchesTable.tournamentId, match.tournamentId),
        eq(knockoutMatchesTable.round, nextWBLabel),
        eq(knockoutMatchesTable.matchNumber, nextMatchNum),
      ));

    if (nextWBMatch) {
      await db.update(knockoutMatchesTable)
        .set({ [winnerSlot]: winnerId })
        .where(eq(knockoutMatchesTable.id, nextWBMatch.id));
    } else {
      // WB Final: winner goes to Grand Final home slot
      const [gf] = await db.select().from(knockoutMatchesTable)
        .where(and(
          eq(knockoutMatchesTable.tournamentId, match.tournamentId),
          eq(knockoutMatchesTable.round, 'grand_final'),
        ));
      if (gf) {
        await db.update(knockoutMatchesTable).set({ homeTeamId: winnerId }).where(eq(knockoutMatchesTable.id, gf.id));
      }
    }

    // Drop loser to LB (or directly to GF for 2-team DE) via stored foreign key
    if (match.loserDropsToMatchId && loserId) {
      const loserSlot = match.loserDropsToSlot === 'home' ? "homeTeamId" : "awayTeamId";
      await db.update(knockoutMatchesTable)
        .set({ [loserSlot]: loserId })
        .where(eq(knockoutMatchesTable.id, match.loserDropsToMatchId));
      // Only cascade byes if the drop target is an actual LB match (not GF for 2-team DE)
      const [lbTarget] = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, match.loserDropsToMatchId));
      if (lbTarget && lbTarget.bracket === 'loser') {
        const lbRoundNum = parseInt(lbTarget.round.slice(1));
        await processLBByeCascade(match.tournamentId, lbTarget.id, lbRoundNum, lbTarget.matchNumber);
      }
    }

  } else if (matchBracket === 'loser') {
    // ── Double-elim: Loser Bracket ─────────────────────────────────────────────
    const lbRoundNum = parseInt(match.round.slice(1)); // 'l3' → 3
    const nextLBLabel = `l${lbRoundNum + 1}`;

    const [nextLBMatches, currentLBRows] = await Promise.all([
      db.select().from(knockoutMatchesTable)
        .where(and(eq(knockoutMatchesTable.tournamentId, match.tournamentId), eq(knockoutMatchesTable.round, nextLBLabel))),
      db.select({ id: knockoutMatchesTable.id }).from(knockoutMatchesTable)
        .where(and(eq(knockoutMatchesTable.tournamentId, match.tournamentId), eq(knockoutMatchesTable.round, match.round))),
    ]);

    if (nextLBMatches.length > 0) {
      // Advance to next LB round using match-count-based logic
      const currCount = currentLBRows.length;
      const nextCount = nextLBMatches.length;
      let targetMatchNum: number;
      let targetSlot: string;
      if (nextCount === currCount) {
        // Same count: 1-to-1 mapping, home slot (winner replaces the position)
        targetMatchNum = match.matchNumber;
        targetSlot = "homeTeamId";
      } else {
        // Fewer matches: pairing — ceil(m/2), home if odd match#, away if even
        targetMatchNum = Math.ceil(match.matchNumber / 2);
        targetSlot = match.matchNumber % 2 !== 0 ? "homeTeamId" : "awayTeamId";
      }
      const targetMatch = nextLBMatches.find((m) => m.matchNumber === targetMatchNum);
      if (targetMatch) {
        await db.update(knockoutMatchesTable)
          .set({ [targetSlot]: winnerId })
          .where(eq(knockoutMatchesTable.id, targetMatch.id));
        await processLBByeCascade(match.tournamentId, targetMatch.id, lbRoundNum + 1, targetMatchNum);
      }
    } else {
      // Last LB round: winner goes to Grand Final away slot
      const [gf] = await db.select().from(knockoutMatchesTable)
        .where(and(
          eq(knockoutMatchesTable.tournamentId, match.tournamentId),
          eq(knockoutMatchesTable.round, 'grand_final'),
        ));
      if (gf) {
        await db.update(knockoutMatchesTable).set({ awayTeamId: winnerId }).where(eq(knockoutMatchesTable.id, gf.id));
      }
    }

  } else if (matchBracket === 'grand_final' && match.round !== 'grand_final_reset') {
    // ── Double-elim: Grand Final ───────────────────────────────────────────────
    // home = WB champion (0 losses), away = LB champion (1 loss)
    if (winnerId === match.homeTeamId) {
      // WB champion wins with 0 losses: tournament over
      await db.update(tournamentTable).set({ status: "completed" }).where(eq(tournamentTable.id, match.tournamentId));
    } else {
      // LB champion wins: both finalists now have exactly 1 loss — need a reset match
      await db.insert(knockoutMatchesTable).values({
        tournamentId: match.tournamentId,
        round: 'grand_final_reset',
        matchNumber: 1,
        homeTeamId: match.homeTeamId, // WB champion (same home/away convention)
        awayTeamId: match.awayTeamId, // LB champion
        played: false,
        bracket: 'grand_final',
      });
    }

  } else if (matchBracket === 'grand_final' && match.round === 'grand_final_reset') {
    // ── Double-elim: Grand Final Reset — both teams had 1 loss; winner is champion ──
    await db.update(tournamentTable).set({ status: "completed" }).where(eq(tournamentTable.id, match.tournamentId));

  } else {
    // ── Single-elim (null bracket): existing advancement logic ─────────────────
    const currentRound = match.round as RoundLabel;
    if (match.round === "third_place") {
      const [final] = await db.select().from(knockoutMatchesTable).where(and(
        eq(knockoutMatchesTable.tournamentId, match.tournamentId),
        eq(knockoutMatchesTable.round, "final"),
      ));
      if (final?.played) {
        await db.update(tournamentTable).set({ status: "completed" }).where(eq(tournamentTable.id, match.tournamentId));
      }
    } else {
    const nxtRound = nextRound(currentRound);
    if (nxtRound) {
      const nextMatchNum = Math.ceil(match.matchNumber / 2);
      const slot = match.matchNumber % 2 !== 0 ? "homeTeamId" : "awayTeamId";
      await db.update(knockoutMatchesTable)
        .set({ [slot]: winnerId })
        .where(and(
          eq(knockoutMatchesTable.tournamentId, match.tournamentId),
          eq(knockoutMatchesTable.round, nxtRound),
          eq(knockoutMatchesTable.matchNumber, nextMatchNum),
        ));
      if (match.round === "semi") {
        const thirdPlaceSlot = match.matchNumber === 1 ? "homeTeamId" : "awayTeamId";
        await db.update(knockoutMatchesTable)
          .set({ [thirdPlaceSlot]: loserId })
          .where(and(
            eq(knockoutMatchesTable.tournamentId, match.tournamentId),
            eq(knockoutMatchesTable.round, "third_place"),
            eq(knockoutMatchesTable.matchNumber, 1),
          ));
      }
    } else {
      const [thirdPlace] = await db.select().from(knockoutMatchesTable).where(and(
        eq(knockoutMatchesTable.tournamentId, match.tournamentId),
        eq(knockoutMatchesTable.round, "third_place"),
      ));
      if (!thirdPlace || thirdPlace.played) {
        await db.update(tournamentTable)
          .set({ status: "completed" })
          .where(eq(tournamentTable.id, match.tournamentId));
      }
    }
    }
  }

  const [updated] = await db.select().from(knockoutMatchesTable).where(eq(knockoutMatchesTable.id, id));
  const [enriched] = await enrichKnockoutMatches([updated]);
  // Broadcast update to any SSE spectators watching this tournament
  broadcast(match.tournamentId);
  res.json(enriched);
});

/* ── Admin: Organizer management ─────────────────────── */

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as Request & { userId: string }).userId = auth.userId;
  isAdminUser(auth.userId).then((admin) => {
    if (!admin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  }).catch(() => {
    res.status(500).json({ error: "Internal server error" });
  });
}

// GET /api/admin/organizers — list all Clerk users merged with local expiry data
router.get("/admin/organizers", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const [clerkResponse, dbOrganizers] = await Promise.all([
      clerkClient.users.getUserList({ limit: 100 }),
      db.select().from(organizersTable),
    ]);
    const expiryByEmail = new Map(dbOrganizers.map((o) => [o.email.toLowerCase(), o.expiresAt]));
    const organizers = clerkResponse.data.map((u) => {
      const email = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ?? "";
      return {
        id: u.id,
        email,
        firstName: u.firstName ?? "",
        lastName: u.lastName ?? "",
        createdAt: new Date(u.createdAt).toISOString(),
        expiresAt: expiryByEmail.get(email.toLowerCase())?.toISOString() ?? null,
      };
    });
    res.json(organizers);
  } catch {
    res.status(500).json({ error: "Failed to fetch organizers" });
  }
});

// POST /api/admin/create-user — create a new organizer account with email + password directly
router.post("/admin/create-user", requireAdmin, async (req, res): Promise<void> => {
  const { email, password, expiresAt } = req.body as { email?: string; password?: string; expiresAt?: string };
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email address is required" });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const expiryDate = expiresAt ? new Date(expiresAt) : null;
  if (expiresAt && isNaN(expiryDate!.getTime())) {
    res.status(400).json({ error: "Invalid expiry date" });
    return;
  }
  try {
    const user = await clerkClient.users.createUser({
      emailAddress: [email],
      password,
      skipPasswordChecks: false,
    });
    // Record in local organizers table so expiry is tracked
    await db
      .insert(organizersTable)
      .values({ email: email.toLowerCase(), expiresAt: expiryDate })
      .onConflictDoUpdate({ target: organizersTable.email, set: { expiresAt: expiryDate } });
    const primaryEmail = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? email;
    res.status(201).json({
      id: user.id,
      email: primaryEmail,
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      createdAt: user.createdAt,
    });
  } catch (err: unknown) {
    const clerkErr = err as { errors?: Array<{ message?: string; longMessage?: string }> };
    const msg = clerkErr?.errors?.[0]?.longMessage ?? clerkErr?.errors?.[0]?.message ?? "Failed to create account";
    res.status(400).json({ error: msg });
  }
});

// PATCH /api/admin/organizers/:userId/expiry — update expiry date for an organizer
router.patch("/admin/organizers/:userId/expiry", requireAdmin, async (req, res): Promise<void> => {
  const userId = req.params.userId as string;
  const { expiresAt } = req.body as { expiresAt?: string | null };
  const expiryDate = expiresAt ? new Date(expiresAt) : null;
  if (expiresAt && isNaN(expiryDate!.getTime())) {
    res.status(400).json({ error: "Invalid expiry date" });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(userId);
    const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? "";
    await db
      .insert(organizersTable)
      .values({ email: email.toLowerCase(), expiresAt: expiryDate })
      .onConflictDoUpdate({ target: organizersTable.email, set: { expiresAt: expiryDate } });
    // Bust the email cache so next request re-checks expiry
    emailCache.delete(userId);
    res.json({ email, expiresAt: expiryDate?.toISOString() ?? null });
  } catch {
    res.status(500).json({ error: "Failed to update expiry" });
  }
});

// DELETE /api/admin/organizers/:userId — remove an organizer account
router.delete("/admin/organizers/:userId", requireAdmin, async (req, res): Promise<void> => {
  const userId = req.params.userId as string;
  const requestingUserId = (req as Request & { userId: string }).userId;
  if (userId === requestingUserId) {
    res.status(400).json({ error: "You cannot remove your own account" });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(userId);
    const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? "";
    await clerkClient.users.deleteUser(userId);
    // Remove from local organizers table and bust caches
    await db.delete(organizersTable).where(eq(organizersTable.email, email.toLowerCase()));
    emailCache.delete(userId);
    adminCache.delete(userId);
    res.sendStatus(204);
  } catch {
    res.status(500).json({ error: "Failed to remove organizer" });
  }
});

// GET /api/admin/tournaments/orphaned — list tournaments with no createdBy
router.get("/admin/tournaments/orphaned", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(tournamentTable)
    .where(isNull(tournamentTable.createdBy))
    .orderBy(tournamentTable.createdAt);
  res.json(rows.map(serializeTournament));
});

// POST /api/admin/tournaments/:id/assign-owner — assign ownership of an orphaned tournament
// Only operates on tournaments with NULL createdBy; returns 409 if already owned.
router.post("/admin/tournaments/:id/assign-owner", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid tournament id" }); return; }
  const { userId } = req.body as { userId?: string };
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  // Check the tournament exists first so we can give a precise error
  const [existing] = await db.select().from(tournamentTable).where(eq(tournamentTable.id, id));
  if (!existing) { res.status(404).json({ error: "Tournament not found" }); return; }
  if (existing.createdBy !== null) {
    res.status(409).json({ error: "Tournament already has an owner" });
    return;
  }
  // Verify the target user exists in Clerk
  try {
    await clerkClient.users.getUser(userId);
  } catch {
    res.status(404).json({ error: "User not found" });
    return;
  }
  // Update only when BOTH id matches AND createdBy IS NULL (guards against concurrent assignment)
  const [t] = await db
    .update(tournamentTable)
    .set({ createdBy: userId })
    .where(and(eq(tournamentTable.id, id), isNull(tournamentTable.createdBy)))
    .returning();
  if (!t) {
    // Another request won the race — tournament was assigned between our check and update
    res.status(409).json({ error: "Tournament already has an owner" });
    return;
  }
  res.json(serializeTournament(t));
});

export default router;
