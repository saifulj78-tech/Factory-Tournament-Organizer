/**
 * Tests for knockout bracket routes:
 *   POST /api/tournaments/:id/generate-knockout
 *   PUT  /api/knockout-matches/:id
 *
 * Covers:
 * - Bracket generation with 3 qualifiers (non-power-of-2 — bye expected)
 * - Bracket generation with 5 qualifiers (non-power-of-2 — byes + cascade expected)
 * - Bracket generation with 4 qualifiers (power-of-2 — no byes)
 * - Bye match is marked played; receiving next-round match is NOT marked played
 * - Winner advances to the correct slot in the next round
 * - Equal scores rejected (no draws in knockout)
 * - Non-owner gets 403 on generate and on score submission
 * - Downstream-played guard blocks editing a match whose successor is already played
 *
 * Seeding: sequential — seed 1 vs 2, seed 3 vs 4, etc.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Capture update call payloads ──────────────────────────────────────────────
export const updateCalls: Array<{ set: Record<string, unknown> }> = [];
export const insertValuesCalls: unknown[] = [];

// ── Database mock ─────────────────────────────────────────────────────────────
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
  query: { breakoutKnockoutsTable: { findFirst: vi.fn().mockResolvedValue(undefined) } },
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  breakoutKnockoutsTable: { id: "id", tournamentId: "tournament_id", position: "position" },
  tournamentTable: { id: "id", createdBy: "created_by", status: "status", format: "format", knockoutFormat: "knockout_format" },
  groupsTable: { id: "id", tournamentId: "tournament_id", groupNumber: "group_number" },
  tournamentCoOrganizersTable: { id: "id", tournamentId: "tournament_id", userId: "user_id" },
  teamsTable: { id: "id", groupId: "group_id" },
  matchesTable: {
    id: "id", groupId: "group_id", played: "played",
    homeTeamId: "home_team_id", awayTeamId: "away_team_id",
    homeScore: "home_score", awayScore: "away_score",
  },
  knockoutMatchesTable: {
    id: "id", tournamentId: "tournament_id", round: "round", matchNumber: "match_number",
    homeTeamId: "home_team_id", awayTeamId: "away_team_id",
    homeScore: "home_score", awayScore: "away_score",
    played: "played", winnerId: "winner_id",
    bracket: "bracket", loserDropsToMatchId: "loser_drops_to_match_id", loserDropsToSlot: "loser_drops_to_slot",
  },
  wildcardPlayoffMatchesTable: {
    id: "id", tournamentId: "tournament_id", gameNumber: "game_number",
    homeTeamId: "home_team_id", awayTeamId: "away_team_id",
    homeScore: "home_score", awayScore: "away_score", played: "played",
  },
  organizersTable: { email: "email", expiresAt: "expires_at", clerkUserId: "clerk_user_id" },
}));

// ── Drizzle ORM helpers mock ──────────────────────────────────────────────────
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (a: unknown, b: unknown) => ({ type: "eq", a, b }),
    isNull: (a: unknown) => ({ type: "isNull", a }),
    inArray: actual.inArray,
    and: (...args: unknown[]) => ({ type: "and", args }),
    lt: (a: unknown, b: unknown) => ({ type: "lt", a, b }),
    asc: actual.asc,
    desc: actual.desc,
  };
});

// ── Clerk mock ────────────────────────────────────────────────────────────────
const OWNER_ID = "user_owner";
const OTHER_ID = "user_other";
const OWNER_EMAIL = "owner@example.com";
const OTHER_EMAIL = "other@example.com";
process.env.ADMIN_EMAIL = "admin@example.com";

const mockGetUser = vi.fn();

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkMiddleware: () => (req: any, _res: any, next: any) => {
      req.auth = { userId: req.headers["x-test-user-id"] ?? null };
      next();
    },
    getAuth: (req: any) => req.auth ?? { userId: null },
    createClerkClient: () => ({
      users: {
        getUser: mockGetUser,
        getUserList: vi.fn().mockResolvedValue({ data: [] }),
        deleteUser: vi.fn(),
      },
      invitations: { createInvitation: vi.fn() },
    }),
  };
});

const { default: app } = await import("../app.js");
const { getBreakoutQualification } = await import("../lib/breakoutQualification.js");

// ── DB chain builders ─────────────────────────────────────────────────────────
function makeSelectChain(rows: unknown[]) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.then = vi.fn((fn: (v: unknown) => unknown) => Promise.resolve(rows).then(fn));
  return chain;
}

describe("breakout qualification uses the existing standings criteria", () => {
  it.each([
    { perGroup: 2, wildcards: 0, expected: [3, 6, 2, 5] },
    { perGroup: 1, wildcards: 1, expected: [3, 6, 2] },
  ])("selects only ranked automatic and wildcard qualifiers: $expected", async ({ perGroup, wildcards, expected }) => {
    const groups = [{ id: 10, tournamentId: 1, groupNumber: 1 }, { id: 20, tournamentId: 1, groupNumber: 2 }];
    const teams = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, groupId: i < 3 ? 10 : 20 }));
    const matches = [
      { groupId: 10, homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 21, played: true },
      { groupId: 10, homeTeamId: 1, awayTeamId: 3, homeScore: 0, awayScore: 21, played: true },
      { groupId: 10, homeTeamId: 2, awayTeamId: 3, homeScore: 11, awayScore: 21, played: true },
      { groupId: 20, homeTeamId: 4, awayTeamId: 5, homeScore: 20, awayScore: 21, played: true },
      { groupId: 20, homeTeamId: 4, awayTeamId: 6, homeScore: 0, awayScore: 21, played: true },
      { groupId: 20, homeTeamId: 5, awayTeamId: 6, homeScore: 10, awayScore: 21, played: true },
    ];
    mockDb.select.mockReset()
      .mockReturnValueOnce(makeSelectChain(matches))
      .mockReturnValueOnce(makeSelectChain(groups))
      .mockReturnValueOnce(makeSelectChain(teams))
      .mockReturnValueOnce(makeSelectChain(matches));
    const result = await getBreakoutQualification({
      id: 1, qualifiersPerGroup: perGroup, wildcardQualifiers: wildcards,
      wildcardRankingMethod: "ppg", wildcardSelectionMethod: "ranking", tiebreakerOrder: "goal_difference,goals_for",
    } as any, groups as any);
    expect(result.ready).toBe(true);
    expect(result.qualifiers.map((qualifier) => qualifier.teamId)).toEqual(expected);
    expect(result.qualifiers.map((qualifier) => qualifier.groupId)).toEqual(expected.map((id) => id <= 3 ? 10 : 20));
  });
});

function makeInsertChain(row: unknown) {
  const chain: any = {};
  chain.values = vi.fn().mockImplementation((values: unknown) => {
    insertValuesCalls.push(values);
    return chain;
  });
  chain.returning = vi.fn().mockResolvedValue([row]);
  return chain;
}

function makeUpdateChain(rows: unknown[] = []) {
  const chain: any = {};
  chain.set = vi.fn().mockImplementation((s: Record<string, unknown>) => {
    updateCalls.push({ set: s });
    return chain;
  });
  chain.where = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(rows);
  chain.then = vi.fn((fn: (v: unknown) => unknown) => Promise.resolve(rows).then(fn));
  return chain;
}

function makeDeleteChain() {
  const chain: any = {};
  chain.where = vi.fn().mockResolvedValue([]);
  return chain;
}

// ── Request helpers ───────────────────────────────────────────────────────────
function ownerRequest(method: "post" | "put" | "delete", path: string) {
  return (request(app) as any)[method](path).set("x-test-user-id", OWNER_ID);
}

function otherRequest(method: "post" | "put" | "delete", path: string) {
  return (request(app) as any)[method](path).set("x-test-user-id", OTHER_ID);
}

// ── Shared fixtures ───────────────────────────────────────────────────────────
const TOURNAMENT = {
  id: 1, name: "Test", format: "group_knockout", qualifiersPerGroup: 1,
  status: "active", createdBy: OWNER_ID, groupCount: 3, teamsPerGroup: 2,
  courtCount: 1, createdAt: new Date(), knockoutFormat: "single",
};

const G1 = { id: 10, groupNumber: 1, name: "A", tournamentId: 1 };
const G2 = { id: 11, groupNumber: 2, name: "B", tournamentId: 1 };
const G3 = { id: 12, groupNumber: 3, name: "C", tournamentId: 1 };
const T1 = { id: 101, name: "Team 1", groupId: 10 };
const T2 = { id: 102, name: "Team 2", groupId: 11 };
const T3 = { id: 103, name: "Team 3", groupId: 12 };

// ── Reset mocks before each test ──────────────────────────────────────────────
beforeEach(() => {
  vi.resetAllMocks();
  updateCalls.length = 0;
  insertValuesCalls.length = 0;

  // Default Clerk: return a non-admin user for any userId
  mockGetUser.mockImplementation((userId: string) => {
    const email = userId === OWNER_ID ? OWNER_EMAIL : OTHER_EMAIL;
    return Promise.resolve({
      id: userId,
      emailAddresses: [{ id: "ea_1", emailAddress: email }],
      primaryEmailAddressId: "ea_1",
    });
  });

  mockDb.select.mockReturnValue(makeSelectChain([]));
  mockDb.delete.mockReturnValue(makeDeleteChain());
  mockDb.update.mockReturnValue(makeUpdateChain([]));
  mockDb.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    execute: vi.fn().mockResolvedValue([]),
    select: mockDb.select,
    delete: mockDb.delete,
  }));
  mockDb.insert.mockReturnValue(makeInsertChain({
    id: 999, tournamentId: 1, round: "final", matchNumber: 1,
    homeTeamId: null, awayTeamId: null, played: false, winnerId: null,
    homeScore: null, awayScore: null, bracket: null,
    loserDropsToMatchId: null, loserDropsToSlot: null,
  }));
});

// ── Helper: enqueue one empty select for checkAccessExpiry ────────────────────
function addOrganizerCheck() {
  mockDb.select.mockReturnValueOnce(makeSelectChain([]));
}

describe("Top 6 standard knockout generation", () => {
  const ranked = [101, 102, 103, 104, 105, 106];
  const teams = ranked.map((id) => ({ id, groupId: 10, name: `Team ${id}` }));

  it.each(["legacy", "breakout"])("protects an existing %s draw when changing knockout format", async (kind) => {
    addOrganizerCheck();
    mockDb.select.mockReturnValueOnce(makeSelectChain([TOURNAMENT]));
    if (kind === "breakout") mockDb.query.breakoutKnockoutsTable.findFirst.mockResolvedValueOnce({ id: 1 });
    mockDb.select.mockReturnValueOnce(makeSelectChain(kind === "legacy" ? [{ id: 99 }] : []));
    if (kind === "breakout") mockDb.select.mockReturnValueOnce(makeSelectChain([{ id: 1, seeds: [101, 102] }]));
    const response = await ownerRequest("put", "/api/tournaments/1").send({
      name: "Test", groupCount: 3, teamsPerGroup: 2, courtCount: 1, format: "group_knockout",
      qualifiersPerGroup: 2, wildcardQualifiers: 0, knockoutFormat: "top6",
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("Reset");
    expect(updateCalls).toHaveLength(0);
  });

  it.each(["seeds", "qualifierTeamIds"])("preserves six ranked %s and gives only the highest two seeds byes", async (field) => {
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([{ ...TOURNAMENT, knockoutFormat: "top6" }]))
      .mockReturnValueOnce(makeSelectChain([G1]));
    if (field === "seeds") {
      mockDb.select.mockReturnValueOnce(makeSelectChain(teams)).mockReturnValueOnce(makeSelectChain([]));
    } else {
      mockDb.select.mockReturnValueOnce(makeSelectChain([])).mockReturnValueOnce(makeSelectChain(teams));
    }
    const response = await ownerRequest("post", "/api/tournaments/1/generate-knockout").send({ [field]: ranked });
    expect(response.status).toBe(201);
    expect(insertValuesCalls.filter((row: any) => row.round === "quarter").map((row: any) => [row.homeTeamId, row.awayTeamId]))
      .toEqual([[101, null], [104, 105], [102, null], [103, 106]]);
  });

  it("rejects an automatic draw with fewer than six qualifiers without inserting matches", async () => {
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([{ ...TOURNAMENT, knockoutFormat: "top6", qualifiersPerGroup: 2, wildcardQualifiers: 0 }]))
      .mockReturnValueOnce(makeSelectChain([G1]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([G1]))
      .mockReturnValueOnce(makeSelectChain(teams))
      .mockReturnValueOnce(makeSelectChain([]));
    const response = await ownerRequest("post", "/api/tournaments/1/generate-knockout").send({});
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("exactly six");
    expect(insertValuesCalls).toHaveLength(0);
  });

  it.each([[101, 102, 103, 104, 105], [101, 102, 103, 104, 105, 105]].map((seeds) => ({ seeds })))("rejects invalid ranked seeds $seeds", async ({ seeds }) => {
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([{ ...TOURNAMENT, knockoutFormat: "top6" }]))
      .mockReturnValueOnce(makeSelectChain([G1]));
    const response = await ownerRequest("post", "/api/tournaments/1/generate-knockout").send({ seeds });
    expect(response.status).toBe(400);
    expect(insertValuesCalls).toHaveLength(0);
  });
});

describe("DELETE /api/tournaments/:id/knockout-bracket", () => {
  it("rejects a non-organizer", async () => {
    addOrganizerCheck();
    mockDb.select.mockReturnValueOnce(makeSelectChain([TOURNAMENT]));

    const res = await otherRequest("delete", "/api/tournaments/1/knockout-bracket");

    expect(res.status).toBe(403);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("blocks reseeding after a knockout score is recorded", async () => {
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([TOURNAMENT]))
      .mockReturnValueOnce(makeSelectChain([{ id: 200 }]));

    const res = await ownerRequest("delete", "/api/tournaments/1/knockout-bracket");

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Reset knockout scores");
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("deletes an unscored bracket so it can be re-seeded", async () => {
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([TOURNAMENT]))
      .mockReturnValueOnce(makeSelectChain([]));

    const res = await ownerRequest("delete", "/api/tournaments/1/knockout-bracket");

    expect(res.status).toBe(204);
    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockDb.delete).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/tournaments/:id/generate-knockout", () => {
  it("rejects non-owner with 403", async () => {
    addOrganizerCheck();
    mockDb.select.mockReturnValueOnce(makeSelectChain([TOURNAMENT]));

    const res = await otherRequest("post", "/api/tournaments/1/generate-knockout");
    expect(res.status).toBe(403);
  });

  it("4 qualifiers (power-of-2) — sequential seeding: T1vT2, T3vT4, no byes", async () => {
    const G4 = { id: 13, groupNumber: 4, name: "D", tournamentId: 1 };
    const T4 = { id: 104, name: "Team 4", groupId: 13 };
    const tournament4 = { ...TOURNAMENT, qualifiersPerGroup: 1, groupCount: 4 };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([tournament4]))           // tournament
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3, G4]))       // getGroupIds
      .mockReturnValueOnce(makeSelectChain([]))                      // unplayed matches
      .mockReturnValueOnce(makeSelectChain([]))                      // existing knockout
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3, G4]))       // getSortedQualifiers: groups
      .mockReturnValueOnce(makeSelectChain([T1, T2, T3, T4]))       // getSortedQualifiers: teams
      .mockReturnValueOnce(makeSelectChain([]));                     // getSortedQualifiers: matches

    // bracketSize=4 → sequential: semi1=T1vT2, semi2=T3vT4, final=empty
    // Sequential seeding: slot[0]=T1, slot[1]=T2, slot[2]=T3, slot[3]=T4
    // Semi1 (m=1): slot[0]=T1 vs slot[1]=T2
    // Semi2 (m=2): slot[2]=T3 vs slot[3]=T4
    const semi1 = { id: 200, tournamentId: 1, round: "semi", matchNumber: 1, homeTeamId: 101, awayTeamId: 102, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    const semi2 = { id: 201, tournamentId: 1, round: "semi", matchNumber: 2, homeTeamId: 103, awayTeamId: 104, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    const finalM = { id: 202, tournamentId: 1, round: "final", matchNumber: 1, homeTeamId: null, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    mockDb.insert
      .mockReturnValueOnce(makeInsertChain(semi1))
      .mockReturnValueOnce(makeInsertChain(semi2))
      .mockReturnValueOnce(makeInsertChain(finalM));

    // No byes → no updates for bye propagation
    const allMatches = [semi1, semi2, finalM];
    mockDb.select
      .mockReturnValueOnce(makeSelectChain(allMatches))              // final select
      .mockReturnValueOnce(makeSelectChain([T1, T2, T3, T4]));      // enrichment

    const res = await ownerRequest("post", "/api/tournaments/1/generate-knockout");
    expect(res.status).toBe(201);
    const matches: any[] = res.body;
    expect(matches.length).toBe(3);

    // Semis have real teams (sequential: T1vT2 and T3vT4) and are unplayed
    const semis = matches.filter((m: any) => m.round === "semi");
    expect(semis.length).toBe(2);
    for (const semi of semis) {
      expect(semi.played).toBe(false);
      expect(semi.homeTeamId).not.toBeNull();
      expect(semi.awayTeamId).not.toBeNull();
    }
    // Sequential seeding: first semi is T1 vs T2
    const s1 = semis.find((m: any) => m.matchNumber === 1);
    expect(s1.homeTeamId).toBe(101); // T1
    expect(s1.awayTeamId).toBe(102); // T2

    // Final slots are still empty
    const finalMatch = matches.find((m: any) => m.round === "final");
    expect(finalMatch.played).toBe(false);
    expect(finalMatch.homeTeamId).toBeNull();
    expect(finalMatch.awayTeamId).toBeNull();

    // No update calls — no byes
    expect(updateCalls.length).toBe(0);
  });

  it("3 qualifiers — sequential seeding: T1vT2 (real), T3 gets bye, advances to Final.away", async () => {
    // Sequential slots for bracketSize=4: [T1, T2, T3, null]
    // Semi1 (m=1): T1 vs T2 → real match
    // Semi2 (m=2): T3 vs null → bye, T3 advances to Final away slot
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([TOURNAMENT]))            // tournament
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3]))           // getGroupIds
      .mockReturnValueOnce(makeSelectChain([]))                      // unplayed matches
      .mockReturnValueOnce(makeSelectChain([]))                      // existing knockout
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3]))           // getSortedQualifiers: groups
      .mockReturnValueOnce(makeSelectChain([T1, T2, T3]))           // getSortedQualifiers: teams
      .mockReturnValueOnce(makeSelectChain([]));                     // getSortedQualifiers: matches

    // Sequential: Semi1=T1vT2 (real), Semi2=T3 vs null (bye)
    const semi1 = { id: 200, tournamentId: 1, round: "semi", matchNumber: 1, homeTeamId: 101, awayTeamId: 102, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    const semi2 = { id: 201, tournamentId: 1, round: "semi", matchNumber: 2, homeTeamId: 103, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    const finalM = { id: 202, tournamentId: 1, round: "final", matchNumber: 1, homeTeamId: null, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    mockDb.insert
      .mockReturnValueOnce(makeInsertChain(semi1))
      .mockReturnValueOnce(makeInsertChain(semi2))
      .mockReturnValueOnce(makeInsertChain(finalM));

    // Bye processing for Semi2 (matchNumber=2, even → awayTeamId in Final):
    // Update A: fill Final.awayTeamId = T3 — must NOT include played or winnerId
    // Update B: mark Semi2 itself as played with winnerId = T3
    mockDb.update
      .mockReturnValueOnce(makeUpdateChain())                        // A: slot fill (Final.awayTeamId=T3)
      .mockReturnValueOnce(makeUpdateChain([{ ...semi2, played: true, winnerId: 103 }])); // B: bye match

    const semi2Done = { ...semi2, played: true, winnerId: 103 };
    const finalWithSlot = { ...finalM, awayTeamId: 103 };
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([semi1, semi2Done, finalWithSlot]))  // final select
      .mockReturnValueOnce(makeSelectChain([T1, T2, T3]));                      // enrichment

    const res = await ownerRequest("post", "/api/tournaments/1/generate-knockout");
    expect(res.status).toBe(201);

    // T3 bye is in Semi2 (matchNumber=2), advances to Final.awayTeamId
    const slotFillUpdate = updateCalls.find(c => "homeTeamId" in c.set || "awayTeamId" in c.set);
    expect(slotFillUpdate).toBeDefined();
    expect(slotFillUpdate!.set).not.toHaveProperty("played");
    expect(slotFillUpdate!.set).not.toHaveProperty("winnerId");
    expect(slotFillUpdate!.set.awayTeamId).toBe(103); // T3 → Final.away (matchNumber=2 is even)

    const byeMatchUpdate = updateCalls.find(c => "played" in c.set && c.set.played === true);
    expect(byeMatchUpdate).toBeDefined();
    expect(byeMatchUpdate!.set.winnerId).toBe(103);
  });

  it("5 qualifiers — cascading byes: T5 skips semi, goes directly to Final.home", async () => {
    const G4 = { id: 13, groupNumber: 4, name: "D", tournamentId: 1 };
    const G5 = { id: 14, groupNumber: 5, name: "E", tournamentId: 1 };
    const T4 = { id: 104, name: "Team 4", groupId: 13 };
    const T5 = { id: 105, name: "Team 5", groupId: 14 };
    const tournament5 = { ...TOURNAMENT, qualifiersPerGroup: 1, groupCount: 5 };

    // Sequential slots for bracketSize=8: [T1,T2,T3,T4,T5,null,null,null]
    // Q1(m=1): T1 vs T2 → real
    // Q2(m=2): T3 vs T4 → real
    // Q3(m=3): T5 vs null → single bye → S2.homeTeamId=T5
    // Q4(m=4): null vs null → double bye → Q4 played, S2.awayTeamId stays null
    // Then S2: T5 vs null → cascading bye → T5 goes to Final.homeTeamId
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([tournament5]))
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3, G4, G5]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3, G4, G5]))
      .mockReturnValueOnce(makeSelectChain([T1, T2, T3, T4, T5]))
      .mockReturnValueOnce(makeSelectChain([]));

    const q1 = { id: 200, tournamentId: 1, round: "quarter", matchNumber: 1, homeTeamId: 101, awayTeamId: 102, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    const q2 = { id: 201, tournamentId: 1, round: "quarter", matchNumber: 2, homeTeamId: 103, awayTeamId: 104, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    const q3 = { id: 202, tournamentId: 1, round: "quarter", matchNumber: 3, homeTeamId: 105, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    const q4 = { id: 203, tournamentId: 1, round: "quarter", matchNumber: 4, homeTeamId: null, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    const s1 = { id: 204, tournamentId: 1, round: "semi", matchNumber: 1, homeTeamId: null, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    const s2 = { id: 205, tournamentId: 1, round: "semi", matchNumber: 2, homeTeamId: null, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    const fin = { id: 206, tournamentId: 1, round: "final", matchNumber: 1, homeTeamId: null, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null };
    mockDb.insert
      .mockReturnValueOnce(makeInsertChain(q1))
      .mockReturnValueOnce(makeInsertChain(q2))
      .mockReturnValueOnce(makeInsertChain(q3))
      .mockReturnValueOnce(makeInsertChain(q4))
      .mockReturnValueOnce(makeInsertChain(s1))
      .mockReturnValueOnce(makeInsertChain(s2))
      .mockReturnValueOnce(makeInsertChain(fin));

    // Expected updates (from processSingleElimByes cascading):
    // 1. Q3 bye: fill S2.homeTeamId=T5 (slot fill, no played/winnerId)
    //    Q3.matchNumber=3 (odd) → homeTeamId of S2
    // 2. Q3 bye: mark Q3 played, winnerId=T5
    // 3. Q4 double-bye: mark Q4 played (no winner, null vs null)
    // 4. Cascade — S2 now has T5 home, null away → bye again
    //    S2.matchNumber=2 (even) → awayTeamId of Final
    //    fill Final.awayTeamId=T5
    // 5. Cascade — S2 marked played, winnerId=T5
    mockDb.update
      .mockReturnValueOnce(makeUpdateChain())  // 1. S2.homeTeamId=T5
      .mockReturnValueOnce(makeUpdateChain([{ ...q3, played: true, winnerId: 105 }]))  // 2. Q3 bye done
      .mockReturnValueOnce(makeUpdateChain([{ ...q4, played: true }]))  // 3. Q4 double-bye done
      .mockReturnValueOnce(makeUpdateChain())  // 4. Final.awayTeamId=T5
      .mockReturnValueOnce(makeUpdateChain([{ ...s2, homeTeamId: 105, played: true, winnerId: 105 }]));  // 5. S2 cascaded bye

    const allMatches = [
      { ...q1 },
      { ...q2 },
      { ...q3, played: true, winnerId: 105 },
      { ...q4, played: true },
      s1,
      { ...s2, homeTeamId: 105, played: true, winnerId: 105 },
      { ...fin, awayTeamId: 105 },  // T5 lands in Final.away (S2 matchNumber=2 is even)
    ];
    mockDb.select
      .mockReturnValueOnce(makeSelectChain(allMatches))
      .mockReturnValueOnce(makeSelectChain([T1, T2, T3, T4, T5]));

    const res = await ownerRequest("post", "/api/tournaments/1/generate-knockout");
    expect(res.status).toBe(201);
    const matches: any[] = res.body;
    expect(matches.length).toBe(7);

    // Q1 and Q2 are real matches, unplayed
    const quarters = matches.filter((m: any) => m.round === "quarter");
    expect(quarters.find((m: any) => m.matchNumber === 1)?.homeTeamId).toBe(101); // T1
    expect(quarters.find((m: any) => m.matchNumber === 1)?.awayTeamId).toBe(102); // T2
    expect(quarters.find((m: any) => m.matchNumber === 2)?.homeTeamId).toBe(103); // T3
    expect(quarters.find((m: any) => m.matchNumber === 2)?.awayTeamId).toBe(104); // T4

    // Q3 and Q4 are played (bye + double-bye)
    expect(quarters.find((m: any) => m.matchNumber === 3)?.played).toBe(true); // Q3 single bye
    expect(quarters.find((m: any) => m.matchNumber === 4)?.played).toBe(true); // Q4 double-bye

    // S1 is unplayed (waiting on real Q1/Q2 results)
    const semis = matches.filter((m: any) => m.round === "semi");
    expect(semis.find((m: any) => m.matchNumber === 1)?.played).toBe(false);

    // S2 is played (T5 cascaded bye), T5 in Final.away (S2 matchNumber=2 is even)
    expect(semis.find((m: any) => m.matchNumber === 2)?.played).toBe(true);
    const finalM2 = matches.find((m: any) => m.round === "final");
    expect(finalM2?.awayTeamId).toBe(105); // T5 in Final.away

    // Slot-fill updates must NOT carry played/winnerId
    const slotFillUpdates = updateCalls.filter(c => !("played" in c.set) && !("winnerId" in c.set));
    expect(slotFillUpdates.length).toBe(2); // S2.homeTeamId=T5, then Final.awayTeamId=T5
    expect(slotFillUpdates[0].set.homeTeamId).toBe(105); // T5 → S2.home (Q3 matchNumber=3 is odd)
    expect(slotFillUpdates[1].set.awayTeamId).toBe(105); // T5 → Final.away (S2 matchNumber=2 is even)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/knockout-matches/:id", () => {
  const MATCH = {
    id: 1, tournamentId: 1, round: "semi", matchNumber: 1,
    homeTeamId: 101, awayTeamId: 102,
    homeScore: null, awayScore: null, played: false, winnerId: null,
    bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null,
  };
  const ACTIVE_TOUR = { ...TOURNAMENT, status: "active" };
  const TEAMS = [
    { id: 101, name: "Team 1", groupId: 10 },
    { id: 102, name: "Team 2", groupId: 11 },
  ];

  function setupSuccessfulScore(homeScore: number, awayScore: number) {
    const winnerId = homeScore > awayScore ? 101 : 102;
    const updatedMatch = { ...MATCH, homeScore, awayScore, played: true, winnerId };
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([MATCH]))                 // match
      .mockReturnValueOnce(makeSelectChain([ACTIVE_TOUR]))           // tournament
      .mockReturnValueOnce(makeSelectChain([updatedMatch]))          // re-fetch after update
      .mockReturnValueOnce(makeSelectChain(TEAMS));                  // enrichment
    mockDb.update
      .mockReturnValueOnce(makeUpdateChain([updatedMatch]))          // update match score
      .mockReturnValueOnce(makeUpdateChain());                       // advance winner to next slot
    return updatedMatch;
  }

  it("rejects non-owner with 403", async () => {
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([MATCH]))
      .mockReturnValueOnce(makeSelectChain([ACTIVE_TOUR]));

    const res = await otherRequest("put", "/api/knockout-matches/1")
      .send({ homeScore: 2, awayScore: 1 });
    expect(res.status).toBe(403);
  });

  it("rejects draws with 400 (no DB calls needed)", async () => {
    const res = await ownerRequest("put", "/api/knockout-matches/1")
      .send({ homeScore: 2, awayScore: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/draw/i);
  });

  it("rejects invalid score types with 400", async () => {
    const res = await ownerRequest("put", "/api/knockout-matches/1")
      .send({ homeScore: "abc", awayScore: 1 });
    expect(res.status).toBe(400);
  });

  it("saves score and advances winner to next-round slot", async () => {
    setupSuccessfulScore(3, 1);
    const res = await ownerRequest("put", "/api/knockout-matches/1")
      .send({ homeScore: 3, awayScore: 1 });
    expect(res.status).toBe(200);
    expect(res.body.played).toBe(true);
    expect(res.body.winnerId).toBe(101);

    const slotUpdate = updateCalls.find(c => "homeTeamId" in c.set || "awayTeamId" in c.set);
    expect(slotUpdate).toBeDefined();
    const slot = slotUpdate!.set.homeTeamId ?? slotUpdate!.set.awayTeamId;
    expect(slot).toBe(101);
  });

  it("marks tournament completed when the final is played", async () => {
    const finalMatch = { ...MATCH, round: "final", matchNumber: 1 };
    const updatedFinal = { ...finalMatch, homeScore: 2, awayScore: 0, played: true, winnerId: 101 };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([finalMatch]))            // match
      .mockReturnValueOnce(makeSelectChain([ACTIVE_TOUR]))           // tournament
      .mockReturnValueOnce(makeSelectChain([updatedFinal]))          // re-fetch
      .mockReturnValueOnce(makeSelectChain(TEAMS));                  // enrichment
    mockDb.update
      .mockReturnValueOnce(makeUpdateChain([updatedFinal]))          // update match
      .mockReturnValueOnce(makeUpdateChain());                       // mark tournament completed

    const res = await ownerRequest("put", "/api/knockout-matches/1")
      .send({ homeScore: 2, awayScore: 0 });
    expect(res.status).toBe(200);

    const completedUpdate = updateCalls.find(c => c.set.status === "completed");
    expect(completedUpdate).toBeDefined();
  });

  it("blocks editing when downstream match is already played", async () => {
    const playedSemi = { ...MATCH, played: true, homeScore: 2, awayScore: 1, winnerId: 101 };
    const playedFinal = {
      id: 10, tournamentId: 1, round: "final", matchNumber: 1,
      homeTeamId: 101, awayTeamId: 102, played: true, homeScore: 1, awayScore: 0, winnerId: 101,
      bracket: null, loserDropsToMatchId: null, loserDropsToSlot: null,
    };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([playedSemi]))            // match (played)
      .mockReturnValueOnce(makeSelectChain([ACTIVE_TOUR]))           // tournament
      .mockReturnValueOnce(makeSelectChain([playedFinal]));          // downstream match (played)

    const res = await ownerRequest("put", "/api/knockout-matches/1")
      .send({ homeScore: 1, awayScore: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/downstream/i);
  });

  it("blocks editing on a completed tournament", async () => {
    const completedTour = { ...ACTIVE_TOUR, status: "completed" };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([MATCH]))
      .mockReturnValueOnce(makeSelectChain([completedTour]));

    const res = await ownerRequest("put", "/api/knockout-matches/1")
      .send({ homeScore: 2, awayScore: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/completed/i);
  });
});

describe("wildcard playoff route integration", () => {
  const RR_TOURNAMENT = {
    ...TOURNAMENT,
    qualifiersPerGroup: 2,
    wildcardQualifiers: 2,
    wildcardSelectionMethod: "round_robin",
    thirdPlacePlayoffEnabled: false,
  };
  const RR_TEAMS = [
    { id: 101, name: "A1", groupId: 10 }, { id: 102, name: "A2", groupId: 10 }, { id: 103, name: "A3", groupId: 10 },
    { id: 104, name: "B1", groupId: 11 }, { id: 105, name: "B2", groupId: 11 }, { id: 106, name: "B3", groupId: 11 },
    { id: 107, name: "C1", groupId: 12 }, { id: 108, name: "C2", groupId: 12 }, { id: 109, name: "C3", groupId: 12 },
  ];
  const GROUP_RESULTS = [10, 11, 12].flatMap((groupId, groupIndex) => {
    const first = groupIndex * 3 + 101;
    return [
      { id: groupId * 10 + 1, groupId, homeTeamId: first, awayTeamId: first + 1, homeScore: 2, awayScore: 0, played: true },
      { id: groupId * 10 + 2, groupId, homeTeamId: first, awayTeamId: first + 2, homeScore: 2, awayScore: 0, played: true },
      { id: groupId * 10 + 3, groupId, homeTeamId: first + 1, awayTeamId: first + 2, homeScore: 1, awayScore: 0, played: true },
    ];
  });
  const THIRD_PLACE_ROWS = [
    { id: 501, tournamentId: 1, gameNumber: 1, homeTeamId: 103, awayTeamId: 106, homeScore: 2, awayScore: 0, played: true },
    { id: 502, tournamentId: 1, gameNumber: 2, homeTeamId: 106, awayTeamId: 109, homeScore: 0, awayScore: 2, played: true },
    { id: 503, tournamentId: 1, gameNumber: 3, homeTeamId: 109, awayTeamId: 103, homeScore: 2, awayScore: 1, played: true },
  ];

  function queueSuccessfulStart() {
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([RR_TOURNAMENT]))
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3]))        // groups for candidates
      .mockReturnValueOnce(makeSelectChain(RR_TEAMS))            // teams for standings
      .mockReturnValueOnce(makeSelectChain(GROUP_RESULTS))       // standings matches
      .mockReturnValueOnce(makeSelectChain(GROUP_RESULTS))       // all-matches-played guard
      .mockReturnValueOnce(makeSelectChain([]))                   // no knockout bracket
      .mockReturnValueOnce(makeSelectChain([]))                   // no prior playoff
      .mockReturnValueOnce(makeSelectChain(THIRD_PLACE_ROWS))     // generated playoff matches
      .mockReturnValueOnce(makeSelectChain(RR_TEAMS));           // match-name enrichment
  }

  function makePlayoffRows(scores: Array<[number, number] | null>) {
    return THIRD_PLACE_ROWS.map((match, index) => ({
      ...match,
      homeScore: scores[index]?.[0] ?? null,
      awayScore: scores[index]?.[1] ?? null,
      played: scores[index] !== null,
    }));
  }

  it("starts with the three current third-place teams after all group matches", async () => {
    queueSuccessfulStart();

    const res = await ownerRequest("post", "/api/tournaments/1/wildcard-playoff");

    expect(res.status).toBe(201);
    expect(insertValuesCalls).toHaveLength(1);
    const inserted = insertValuesCalls[0] as Array<Record<string, number | boolean>>;
    expect(inserted).toEqual([
      { tournamentId: 1, gameNumber: 1, homeTeamId: 103, awayTeamId: 106, played: false },
      { tournamentId: 1, gameNumber: 2, homeTeamId: 106, awayTeamId: 109, played: false },
      { tournamentId: 1, gameNumber: 3, homeTeamId: 109, awayTeamId: 103, played: false },
    ]);
  });

  it("scores all three matches and public GET returns the two qualified teams", async () => {
    const allTeams = [103, 106, 109].map((id) => RR_TEAMS.find((team) => team.id === id)!);
    const finalRows = makePlayoffRows([[2, 0], [0, 2], [2, 1]]);

    for (const row of finalRows) {
      addOrganizerCheck();
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([row]))            // playoff match
        .mockReturnValueOnce(makeSelectChain([RR_TOURNAMENT]))  // tournament
        .mockReturnValueOnce(makeSelectChain([]))                // no bracket yet
        .mockReturnValueOnce(makeSelectChain(finalRows))         // response playoff state
        .mockReturnValueOnce(makeSelectChain(allTeams));         // state team names
      mockDb.update.mockReturnValueOnce(makeUpdateChain());
      const res = await ownerRequest("put", `/api/tournaments/1/wildcard-playoff/${row.id}`)
        .send({ homeScore: row.homeScore, awayScore: row.awayScore });
      expect(res.status).toBe(200);
    }

    mockDb.select
      .mockReturnValueOnce(makeSelectChain([{ id: 1 }]))         // public GET tournament existence
      .mockReturnValueOnce(makeSelectChain(finalRows))
      .mockReturnValueOnce(makeSelectChain(allTeams));
    const get = await request(app).get("/api/tournaments/1/wildcard-playoff");

    expect(get.status).toBe(200);
    expect(get.body.qualifiedTeamIds).toEqual([109, 103]);
    expect(get.body.tieAtCutoff).toBe(false);
    expect(get.body.matches.every((match: any) => match.played)).toBe(true);
    expect(get.body.standings.map((standing: any) => standing.teamId)).toEqual([109, 103, 106]);
  });

  function queueAutomaticGeneration(playoffRows: typeof THIRD_PLACE_ROWS) {
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([RR_TOURNAMENT]))    // tournament
      .mockReturnValueOnce(makeSelectChain([{ id: 10 }, { id: 11 }, { id: 12 }])) // group IDs
      .mockReturnValueOnce(makeSelectChain(GROUP_RESULTS))      // all group matches played
      .mockReturnValueOnce(makeSelectChain([]))                  // no bracket
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3]))       // qualifier standings: groups
      .mockReturnValueOnce(makeSelectChain(RR_TEAMS))            // qualifier standings: teams
      .mockReturnValueOnce(makeSelectChain(GROUP_RESULTS))      // qualifier standings: matches
      .mockReturnValueOnce(makeSelectChain(playoffRows))        // playoff standings matches
      .mockReturnValueOnce(makeSelectChain(RR_TEAMS))            // playoff team names
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3]))       // current third-place groups
      .mockReturnValueOnce(makeSelectChain(RR_TEAMS))            // current third-place teams
      .mockReturnValueOnce(makeSelectChain(GROUP_RESULTS))      // current third-place group results
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3]))       // ordering groups
      .mockReturnValueOnce(makeSelectChain(RR_TEAMS));           // tournament team list
  }

  it("uses completed playoff qualifiers in automatically generated knockout seeds", async () => {
    queueAutomaticGeneration(THIRD_PLACE_ROWS);
    const insertedRows: Array<Record<string, any>> = [];
    mockDb.insert.mockImplementation(() => {
      const chain: any = {};
      let values: Record<string, any>;
      chain.values = vi.fn((nextValues: Record<string, any>) => {
        insertValuesCalls.push(nextValues);
        values = nextValues;
        return chain;
      });
      chain.returning = vi.fn().mockImplementation(async () => {
        const row = {
          id: 600 + insertedRows.length,
          ...values,
          homeScore: null,
          awayScore: null,
          played: false,
          winnerId: null,
          bracket: null,
          loserDropsToMatchId: null,
          loserDropsToSlot: null,
        };
        insertedRows.push(row);
        return [row];
      });
      return chain;
    });
    mockDb.select
      .mockReturnValueOnce(makeSelectChain(insertedRows))
      .mockReturnValueOnce(makeSelectChain(RR_TEAMS));

    const res = await ownerRequest("post", "/api/tournaments/1/generate-knockout");

    expect(res.status).toBe(201);
    const firstRound = insertValuesCalls
      .filter((values): values is Record<string, any> => !Array.isArray(values) && (values as any).round === "quarter");
    const seededWildcardIds = firstRound.flatMap(({ homeTeamId, awayTeamId }) => [homeTeamId, awayTeamId]);
    expect(seededWildcardIds).toContain(109);
    expect(seededWildcardIds).toContain(103);
    expect(seededWildcardIds).not.toContain(106);
  });

  it("blocks automatic generation on a tied cutoff but permits manual seeds", async () => {
    const tiedRows = [
      { ...THIRD_PLACE_ROWS[0], homeScore: 1, awayScore: 0 },
      { ...THIRD_PLACE_ROWS[1], homeScore: 1, awayScore: 0 },
      { ...THIRD_PLACE_ROWS[2], homeScore: 1, awayScore: 0 },
    ];
    // This schedule produces a cyclic one-win-each result with identical goals.
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([RR_TOURNAMENT]))
      .mockReturnValueOnce(makeSelectChain([{ id: 10 }, { id: 11 }, { id: 12 }]))
      .mockReturnValueOnce(makeSelectChain(GROUP_RESULTS))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3]))
      .mockReturnValueOnce(makeSelectChain(RR_TEAMS))
      .mockReturnValueOnce(makeSelectChain(GROUP_RESULTS))
      .mockReturnValueOnce(makeSelectChain(tiedRows))
      .mockReturnValueOnce(makeSelectChain(RR_TEAMS));

    const automatic = await ownerRequest("post", "/api/tournaments/1/generate-knockout");
    expect(automatic.status).toBe(409);
    expect(automatic.body.error).toMatch(/tied at the qualification cutoff/i);
    expect(mockDb.insert).not.toHaveBeenCalled();

    const final = {
      id: 701, tournamentId: 1, round: "final", matchNumber: 1,
      homeTeamId: 101, awayTeamId: 102, homeScore: null, awayScore: null,
      played: false, winnerId: null, bracket: null,
      loserDropsToMatchId: null, loserDropsToSlot: null,
    };
    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([RR_TOURNAMENT]))
      .mockReturnValueOnce(makeSelectChain([{ id: 10 }, { id: 11 }, { id: 12 }]))
      .mockReturnValueOnce(makeSelectChain(RR_TEAMS))
      .mockReturnValueOnce(makeSelectChain([]))             // no existing bracket
      .mockReturnValueOnce(makeSelectChain([final]))         // generated bracket
      .mockReturnValueOnce(makeSelectChain(RR_TEAMS));       // enrichment
    mockDb.insert.mockReturnValueOnce(makeInsertChain(final));

    const manual = await ownerRequest("post", "/api/tournaments/1/generate-knockout")
      .send({ seeds: [101, 102] });
    expect(manual.status).toBe(201);
    expect((insertValuesCalls.at(-1) as any)).toMatchObject({
      tournamentId: 1, round: "final", homeTeamId: 101, awayTeamId: 102,
    });
  });
});

describe("POST /api/matches/:id", () => {
  const START_OWNER_ID = "start-owner";
  const START_OTHER_ID = "start-other";
  const GROUP_MATCH = {
    id: 1, groupId: 10, homeTeamId: 101, awayTeamId: 102,
    homeScore: null, awayScore: null, played: false, startedAt: null,
    roundNumber: 1, courtNumber: 1,
  };

  it("rejects a non-organizer with 403 without updating the match", async () => {
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([])) // access-expiry check
      .mockReturnValueOnce(makeSelectChain([GROUP_MATCH]))
      .mockReturnValueOnce(makeSelectChain([G1]))
      .mockReturnValueOnce(makeSelectChain([{ ...TOURNAMENT, createdBy: START_OWNER_ID }]))
      .mockReturnValueOnce(makeSelectChain([])); // not a co-organizer

    const res = await (request(app) as any).post("/api/matches/1").set("x-test-user-id", START_OTHER_ID);
    expect(res.status).toBe(403);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("records the start time for the tournament organizer", async () => {
    const startedAt = new Date("2026-08-22T05:00:00.000Z");
    const updatedMatch = { ...GROUP_MATCH, startedAt };
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([])) // access-expiry check
      .mockReturnValueOnce(makeSelectChain([GROUP_MATCH]))
      .mockReturnValueOnce(makeSelectChain([G1]))
      .mockReturnValueOnce(makeSelectChain([{ ...TOURNAMENT, createdBy: START_OWNER_ID }]))
      .mockReturnValueOnce(makeSelectChain([T1, T2])); // enrichment
    mockDb.update.mockReturnValueOnce(makeUpdateChain([updatedMatch]));

    const res = await (request(app) as any).post("/api/matches/1").set("x-test-user-id", START_OWNER_ID);
    expect(res.status).toBe(200);
    expect(res.body.played).toBe(false);
    expect(res.body.startedAt).toBe(startedAt.toISOString());
    expect(updateCalls[0].set.startedAt).toBeInstanceOf(Date);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Double-elimination tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared DE tournament fixture and team/group stubs
 * 4 groups × 1 qualifier each = 4 qualifiers → wbSize=4, n=2, numLBRounds=2
 */
const DE_TOURNAMENT = {
  ...TOURNAMENT, knockoutFormat: "double", qualifiersPerGroup: 1, groupCount: 4,
};
const G4_DE = { id: 13, groupNumber: 4, name: "D", tournamentId: 1 };
const T4_DE = { id: 104, name: "Team 4", groupId: 13 };

// Bracket objects for wbSize=4 DE
// Insert order: LB R1 M1, LB R2 M1, GF, WB R1 M1, WB R1 M2, WB R2 M1
const LB_R1_M1 = { id: 300, tournamentId: 1, round: "l1", matchNumber: 1, homeTeamId: null, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: "loser", loserDropsToMatchId: null, loserDropsToSlot: null };
const LB_R2_M1 = { id: 301, tournamentId: 1, round: "l2", matchNumber: 1, homeTeamId: null, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: "loser", loserDropsToMatchId: null, loserDropsToSlot: null };
const GF_MATCH = { id: 302, tournamentId: 1, round: "grand_final", matchNumber: 1, homeTeamId: null, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: "grand_final", loserDropsToMatchId: null, loserDropsToSlot: null };
// WB R1 M1 drops loser to LB R1 M1 home slot (i=1, m=1 odd)
const WB_R1_M1 = { id: 303, tournamentId: 1, round: "w1", matchNumber: 1, homeTeamId: 101, awayTeamId: 102, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: "winner", loserDropsToMatchId: 300, loserDropsToSlot: "home" };
// WB R1 M2 drops loser to LB R1 M1 away slot (i=1, m=2 even)
const WB_R1_M2 = { id: 304, tournamentId: 1, round: "w1", matchNumber: 2, homeTeamId: 103, awayTeamId: 104, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: "winner", loserDropsToMatchId: 300, loserDropsToSlot: "away" };
// WB R2 M1 (WB Final) drops loser to LB R2 M1 away slot (i=2 ≥2, same matchNumber, away)
const WB_R2_M1 = { id: 305, tournamentId: 1, round: "w2", matchNumber: 1, homeTeamId: null, awayTeamId: null, played: false, winnerId: null, homeScore: null, awayScore: null, bracket: "winner", loserDropsToMatchId: 301, loserDropsToSlot: "away" };

/** Set up the mock insert sequence for a 4-qualifier DE generation */
function setupDE4Generation() {
  addOrganizerCheck();
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([DE_TOURNAMENT]))
    .mockReturnValueOnce(makeSelectChain([G1, G2, G3, G4_DE]))      // getGroupIds
    .mockReturnValueOnce(makeSelectChain([]))                         // unplayed
    .mockReturnValueOnce(makeSelectChain([]))                         // existing knockout
    .mockReturnValueOnce(makeSelectChain([G1, G2, G3, G4_DE]))      // getSortedQualifiers: groups
    .mockReturnValueOnce(makeSelectChain([T1, T2, T3, T4_DE]))      // getSortedQualifiers: teams
    .mockReturnValueOnce(makeSelectChain([]));                        // getSortedQualifiers: matches

  // Insert order: LB R1 M1, LB R2 M1, GF, WB R1 M1, WB R1 M2, WB R2 M1
  mockDb.insert
    .mockReturnValueOnce(makeInsertChain(LB_R1_M1))
    .mockReturnValueOnce(makeInsertChain(LB_R2_M1))
    .mockReturnValueOnce(makeInsertChain(GF_MATCH))
    .mockReturnValueOnce(makeInsertChain(WB_R1_M1))
    .mockReturnValueOnce(makeInsertChain(WB_R1_M2))
    .mockReturnValueOnce(makeInsertChain(WB_R2_M1));
}

describe("Double Elimination — bracket generation", () => {
  it("2 qualifiers (minimum): WB R1 loser drops directly to GF away slot, no LB rounds", async () => {
    // wbSize=2, n=1, numLBRounds=0 — the degenerate case
    // WB R1 M1: T1 vs T2 → winner to GF home, loser to GF away directly
    const deTour2 = { ...DE_TOURNAMENT, groupCount: 2, qualifiersPerGroup: 1 };
    const G2_DE = { id: 11, groupNumber: 2, name: "B", tournamentId: 1 };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([deTour2]))
      .mockReturnValueOnce(makeSelectChain([G1, G2_DE]))              // getGroupIds
      .mockReturnValueOnce(makeSelectChain([]))                        // unplayed
      .mockReturnValueOnce(makeSelectChain([]))                        // existing knockout
      .mockReturnValueOnce(makeSelectChain([G1, G2_DE]))              // getSortedQualifiers: groups
      .mockReturnValueOnce(makeSelectChain([T1, T2]))                 // getSortedQualifiers: teams
      .mockReturnValueOnce(makeSelectChain([]));                       // getSortedQualifiers: matches

    // Insert order for wbSize=2 (numLBRounds=0): no LB inserts, just GF then WB R1 M1
    const gf2 = { ...GF_MATCH, id: 350 };
    const wb1_2 = {
      id: 351, tournamentId: 1, round: "w1", matchNumber: 1,
      homeTeamId: 101, awayTeamId: 102, played: false, winnerId: null,
      homeScore: null, awayScore: null, bracket: "winner",
      loserDropsToMatchId: 350, loserDropsToSlot: "away", // loser drops to GF away directly
    };
    mockDb.insert
      .mockReturnValueOnce(makeInsertChain(gf2))                      // GF (no LB rounds precede it)
      .mockReturnValueOnce(makeInsertChain(wb1_2));                   // WB R1 M1

    // No byes (both teams real), no updates during generation
    const allDE2 = [gf2, wb1_2];
    mockDb.select
      .mockReturnValueOnce(makeSelectChain(allDE2))
      .mockReturnValueOnce(makeSelectChain([T1, T2]));

    const res = await ownerRequest("post", "/api/tournaments/1/generate-knockout");
    expect(res.status).toBe(201);
    const matches: any[] = res.body;

    // Only 2 matches: GF + WB R1
    expect(matches.length).toBe(2);

    // WB R1 M1: T1 vs T2, loser drops directly to GF (id=350) away slot
    const wb = matches.find((m: any) => m.round === "w1");
    expect(wb.homeTeamId).toBe(101);
    expect(wb.awayTeamId).toBe(102);
    expect(wb.loserDropsToMatchId).toBe(350);
    expect(wb.loserDropsToSlot).toBe("away");

    // No LB rounds
    expect(matches.filter((m: any) => m.round?.startsWith("l")).length).toBe(0);

    // No bye updates
    expect(updateCalls.length).toBe(0);
  });

  it("4 qualifiers (power-of-2): creates WB/LB/GF with correct loserDropsTo links, no byes", async () => {
    setupDE4Generation();

    // No byes → no updates during generation; fetch all + enrich
    const allDE = [LB_R1_M1, LB_R2_M1, GF_MATCH, WB_R1_M1, WB_R1_M2, WB_R2_M1];
    const teams = [T1, T2, T3, T4_DE];
    mockDb.select
      .mockReturnValueOnce(makeSelectChain(allDE))
      .mockReturnValueOnce(makeSelectChain(teams));

    const res = await ownerRequest("post", "/api/tournaments/1/generate-knockout");
    expect(res.status).toBe(201);
    const matches: any[] = res.body;

    // 2 LB + 1 GF + 3 WB = 6 matches
    expect(matches.length).toBe(6);

    // WB R1 M1: T1 vs T2 (sequential seeding), drops to LB R1 M1 home slot
    const wb1m1 = matches.find((m: any) => m.round === "w1" && m.matchNumber === 1);
    expect(wb1m1.homeTeamId).toBe(101);
    expect(wb1m1.awayTeamId).toBe(102);
    expect(wb1m1.loserDropsToMatchId).toBe(300);
    expect(wb1m1.loserDropsToSlot).toBe("home");

    // WB R1 M2: T3 vs T4, drops to LB R1 M1 away slot
    const wb1m2 = matches.find((m: any) => m.round === "w1" && m.matchNumber === 2);
    expect(wb1m2.homeTeamId).toBe(103);
    expect(wb1m2.awayTeamId).toBe(104);
    expect(wb1m2.loserDropsToMatchId).toBe(300);
    expect(wb1m2.loserDropsToSlot).toBe("away");

    // WB Final: drops to LB R2 M1 away slot
    const wb2m1 = matches.find((m: any) => m.round === "w2");
    expect(wb2m1.loserDropsToMatchId).toBe(301);
    expect(wb2m1.loserDropsToSlot).toBe("away");

    // No updates — no byes
    expect(updateCalls.length).toBe(0);
  });

  it("3 qualifiers (non-power-of-2, wbSize=4): WB R1 M2 is a single bye, cascades correctly", async () => {
    // 3 qualifiers → wbSize=4. wbSlots=[T1,T2,T3,null]
    // WB R1 M1: T1 vs T2 → real
    // WB R1 M2: T3 vs null → single bye; T3 advances to WB R2 (M2 is even → away slot of WB R2 M1)
    //   No loser drops to LB from a bye match
    const deTour3 = { ...DE_TOURNAMENT, groupCount: 3, qualifiersPerGroup: 1 };
    const wb_r1_m2_bye = { ...WB_R1_M2, homeTeamId: 103, awayTeamId: null };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([deTour3]))
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([G1, G2, G3]))
      .mockReturnValueOnce(makeSelectChain([T1, T2, T3]))
      .mockReturnValueOnce(makeSelectChain([]));

    mockDb.insert
      .mockReturnValueOnce(makeInsertChain(LB_R1_M1))
      .mockReturnValueOnce(makeInsertChain(LB_R2_M1))
      .mockReturnValueOnce(makeInsertChain(GF_MATCH))
      .mockReturnValueOnce(makeInsertChain(WB_R1_M1))
      .mockReturnValueOnce(makeInsertChain(wb_r1_m2_bye))    // T3 vs null
      .mockReturnValueOnce(makeInsertChain(WB_R2_M1));

    // Bye processing for WB R1 M2 (single bye, matchNumber=2 even → away slot of WB R2):
    // 1. Fill WB R2 M1 awayTeamId = T3
    // 2. Mark WB R1 M2 played, winnerId = T3
    mockDb.update
      .mockReturnValueOnce(makeUpdateChain())                           // fill WB R2 M1 away = T3
      .mockReturnValueOnce(makeUpdateChain([{ ...wb_r1_m2_bye, played: true, winnerId: 103 }])); // mark R1 M2 played

    // LB R1 M2 source check (processLBByeCascade is NOT called for WB byes — no loser drops)
    const wb_r2_with_t3 = { ...WB_R2_M1, awayTeamId: 103 };
    const allDE3 = [LB_R1_M1, LB_R2_M1, GF_MATCH, WB_R1_M1, { ...wb_r1_m2_bye, played: true, winnerId: 103 }, wb_r2_with_t3];
    mockDb.select
      .mockReturnValueOnce(makeSelectChain(allDE3))
      .mockReturnValueOnce(makeSelectChain([T1, T2, T3]));

    const res = await ownerRequest("post", "/api/tournaments/1/generate-knockout");
    expect(res.status).toBe(201);

    // WB R1 M2 (single bye) is played; T3 is in WB Final away slot
    const byeMatch = res.body.find((m: any) => m.round === "w1" && m.matchNumber === 2);
    expect(byeMatch.played).toBe(true);
    const wbFinal = res.body.find((m: any) => m.round === "w2");
    expect(wbFinal.awayTeamId).toBe(103);

    // Verify slot fill did NOT include played/winnerId
    const slotFill = updateCalls.find((c) => "awayTeamId" in c.set && !("played" in c.set));
    expect(slotFill).toBeDefined();
    expect(slotFill!.set.awayTeamId).toBe(103);
  });
});

describe("Double Elimination — scoring", () => {
  const DE_ACTIVE_TOUR = { ...DE_TOURNAMENT, status: "active" };
  const DE_TEAMS = [
    { id: 101, name: "Team 1", groupId: 10 },
    { id: 102, name: "Team 2", groupId: 11 },
    { id: 103, name: "Team 3", groupId: 12 },
    { id: 104, name: "Team 4", groupId: 13 },
  ];

  it("WB match: winner advances to next WB round, loser drops to LB via stored FK", async () => {
    // WB R1 M1: T1(home) vs T2(away) → T1 wins, T2 drops to LB R1 M1 home slot
    const wbMatch = { ...WB_R1_M1 };
    const updatedWB = { ...wbMatch, homeScore: 2, awayScore: 1, played: true, winnerId: 101 };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([wbMatch]))                 // fetch match
      .mockReturnValueOnce(makeSelectChain([DE_ACTIVE_TOUR]))          // tournament
      // WB winner advance: find next WB round match
      .mockReturnValueOnce(makeSelectChain([WB_R2_M1]))               // nextWBMatch
      // Loser drop: select LB target by id (for processLBByeCascade)
      .mockReturnValueOnce(makeSelectChain([LB_R1_M1]))               // LB target fetch
      // processLBByeCascade: fetch LB match by id → now has homeTeamId=102 (loser just dropped)
      .mockReturnValueOnce(makeSelectChain([{ ...LB_R1_M1, homeTeamId: 102 }]))
      // processLBByeCascade: check other slot source (WB R1 M2) played? → not played
      .mockReturnValueOnce(makeSelectChain([{ played: false }]))
      // re-fetch updated match + enrichment
      .mockReturnValueOnce(makeSelectChain([updatedWB]))
      .mockReturnValueOnce(makeSelectChain(DE_TEAMS));

    mockDb.update
      .mockReturnValueOnce(makeUpdateChain([updatedWB]))               // score the WB match
      .mockReturnValueOnce(makeUpdateChain())                          // fill WB R2 M1 slot
      .mockReturnValueOnce(makeUpdateChain());                         // drop loser to LB R1 M1 home

    const res = await ownerRequest("put", "/api/knockout-matches/303")
      .send({ homeScore: 2, awayScore: 1 });
    expect(res.status).toBe(200);
    expect(res.body.played).toBe(true);
    expect(res.body.winnerId).toBe(101);

    // Winner T1 should advance to WB R2
    const wbSlotFill = updateCalls.find((c) => "homeTeamId" in c.set || "awayTeamId" in c.set);
    expect(wbSlotFill).toBeDefined();

    // Loser T2 should drop to LB R1 M1 home slot
    const lbSlotFill = updateCalls.find((c) => "homeTeamId" in c.set && c.set.homeTeamId === 102);
    expect(lbSlotFill).toBeDefined();
  });

  it("LB match (same match count in next round): winner goes to same match#, home slot", async () => {
    // LB R1 M1 (l1): has 1 match; next is LB R2 (l2): also has 1 match → same count → home slot
    const lbMatch = { ...LB_R1_M1, homeTeamId: 102, awayTeamId: 104 };
    const updatedLB = { ...lbMatch, homeScore: 3, awayScore: 0, played: true, winnerId: 102 };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([lbMatch]))                  // fetch match
      .mockReturnValueOnce(makeSelectChain([DE_ACTIVE_TOUR]))           // tournament
      // LB winner advance: fetch nextLBMatches + currentLBRows (Promise.all)
      .mockReturnValueOnce(makeSelectChain([LB_R2_M1]))                // nextLBMatches (l2)
      .mockReturnValueOnce(makeSelectChain([LB_R1_M1]))                // currentLBRows (l1, count=1)
      // processLBByeCascade after advancing to LB R2 M1
      .mockReturnValueOnce(makeSelectChain([{ ...LB_R2_M1, homeTeamId: 102 }]))  // LB R2 M1 now has home
      // check away slot source: WB R2 M1 (k=2, lbRound=2, wbK=2) played?
      .mockReturnValueOnce(makeSelectChain([{ played: false }]))
      // re-fetch + enrichment
      .mockReturnValueOnce(makeSelectChain([updatedLB]))
      .mockReturnValueOnce(makeSelectChain(DE_TEAMS));

    mockDb.update
      .mockReturnValueOnce(makeUpdateChain([updatedLB]))               // score match
      .mockReturnValueOnce(makeUpdateChain())                          // fill LB R2 M1 home slot
      .mockReturnValueOnce(makeUpdateChain());                         // (spare)

    const res = await ownerRequest("put", "/api/knockout-matches/300")
      .send({ homeScore: 3, awayScore: 0 });
    expect(res.status).toBe(200);

    // Same count (l1=1 match, l2=1 match) → winner goes to homeTeamId of same match number
    const slotFill = updateCalls.find((c) => "homeTeamId" in c.set && c.set.homeTeamId === 102);
    expect(slotFill).toBeDefined();
  });

  it("LB last round: winner goes to GF away slot", async () => {
    // LB R2 is the last LB round for wbSize=4 — nextLBMatches will be empty
    const lbFinal = { ...LB_R2_M1, homeTeamId: 102, awayTeamId: 104 };
    const updatedLBF = { ...lbFinal, homeScore: 2, awayScore: 1, played: true, winnerId: 102 };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([lbFinal]))
      .mockReturnValueOnce(makeSelectChain([DE_ACTIVE_TOUR]))
      // Promise.all: nextLBMatches (l3 → empty), currentLBRows (l2, count=1)
      .mockReturnValueOnce(makeSelectChain([]))                        // nextLBMatches empty
      .mockReturnValueOnce(makeSelectChain([LB_R2_M1]))               // currentLBRows
      // No next LB → advance to GF away slot
      .mockReturnValueOnce(makeSelectChain([GF_MATCH]))               // find GF
      .mockReturnValueOnce(makeSelectChain([updatedLBF]))
      .mockReturnValueOnce(makeSelectChain(DE_TEAMS));

    mockDb.update
      .mockReturnValueOnce(makeUpdateChain([updatedLBF]))              // score match
      .mockReturnValueOnce(makeUpdateChain());                         // fill GF away slot

    const res = await ownerRequest("put", "/api/knockout-matches/301")
      .send({ homeScore: 2, awayScore: 1 });
    expect(res.status).toBe(200);

    const gfSlot = updateCalls.find((c) => "awayTeamId" in c.set && c.set.awayTeamId === 102);
    expect(gfSlot).toBeDefined();
  });

  it("WB match: blocks edit when WB winner's next match has already been played", async () => {
    // WB R1 M1 already played; its winner's WB R2 match is also played → block
    const wbPlayed = { ...WB_R1_M1, homeScore: 2, awayScore: 1, played: true, winnerId: 101 };
    const wbR2Played = { ...WB_R2_M1, homeScore: 3, awayScore: 0, played: true, winnerId: 103 };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([wbPlayed]))
      .mockReturnValueOnce(makeSelectChain([DE_ACTIVE_TOUR]))
      // downstream check: nextWBMatch (w2 M1) is played
      .mockReturnValueOnce(makeSelectChain([wbR2Played]));

    const res = await ownerRequest("put", "/api/knockout-matches/303")
      .send({ homeScore: 1, awayScore: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/winner.*already played|already played.*winner/i);
  });

  it("WB match: blocks edit when the eliminated team has already played in the Loser Bracket", async () => {
    // WB R1 M1 already played; the LB target (LB R1 M1) is also played → block
    const wbPlayed = { ...WB_R1_M1, homeScore: 2, awayScore: 1, played: true, winnerId: 101 };
    const lb1Played = { ...LB_R1_M1, homeTeamId: 102, homeScore: 3, awayScore: 1, played: true, winnerId: 102 };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([wbPlayed]))
      .mockReturnValueOnce(makeSelectChain([DE_ACTIVE_TOUR]))
      // downstream guard: nextWBMatch (w2 M1) is NOT played yet
      .mockReturnValueOnce(makeSelectChain([WB_R2_M1]))
      // downstream guard: LB target is played
      .mockReturnValueOnce(makeSelectChain([lb1Played]));

    const res = await ownerRequest("put", "/api/knockout-matches/303")
      .send({ homeScore: 1, awayScore: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/eliminated team.*already played|already played.*Loser Bracket/i);
  });

  it("LB match: blocks edit when LB winner's next match is already played", async () => {
    const lb1Played = { ...LB_R1_M1, homeTeamId: 102, awayTeamId: 104, homeScore: 3, awayScore: 1, played: true, winnerId: 102 };
    const lb2Played = { ...LB_R2_M1, homeTeamId: 102, homeScore: 2, awayScore: 0, played: true, winnerId: 102 };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([lb1Played]))
      .mockReturnValueOnce(makeSelectChain([DE_ACTIVE_TOUR]))
      // downstream guard for LB: nextLBMatches (l2) + currentLBRows (l1)
      .mockReturnValueOnce(makeSelectChain([lb2Played]))   // nextLBMatches (l2, played)
      .mockReturnValueOnce(makeSelectChain([LB_R1_M1]));   // currentLBRows count

    const res = await ownerRequest("put", "/api/knockout-matches/300")
      .send({ homeScore: 1, awayScore: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/winner.*already played|already played.*Loser Bracket/i);
  });

  it("Grand Final: blocks edit when a reset match already exists", async () => {
    const gfPlayed = { ...GF_MATCH, homeTeamId: 101, awayTeamId: 102, homeScore: 1, awayScore: 2, played: true, winnerId: 102 };
    const resetExists = {
      id: 400, tournamentId: 1, round: "grand_final_reset", matchNumber: 1,
      homeTeamId: 101, awayTeamId: 102, played: false, winnerId: null,
      homeScore: null, awayScore: null, bracket: "grand_final",
      loserDropsToMatchId: null, loserDropsToSlot: null,
    };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([gfPlayed]))
      .mockReturnValueOnce(makeSelectChain([DE_ACTIVE_TOUR]))
      // downstream guard for GF: check for grand_final_reset
      .mockReturnValueOnce(makeSelectChain([resetExists]));

    const res = await ownerRequest("put", "/api/knockout-matches/302")
      .send({ homeScore: 2, awayScore: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/reset match/i);
  });

  it("Grand Final — WB champion (home) wins: tournament marked complete immediately, no reset", async () => {
    // WB champion (home=T1) wins GF → tournament complete, no insert of reset match
    const gf = { ...GF_MATCH, homeTeamId: 101, awayTeamId: 102 };
    const updatedGF = { ...gf, homeScore: 3, awayScore: 1, played: true, winnerId: 101 };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([gf]))
      .mockReturnValueOnce(makeSelectChain([DE_ACTIVE_TOUR]))
      .mockReturnValueOnce(makeSelectChain([updatedGF]))
      .mockReturnValueOnce(makeSelectChain(DE_TEAMS));

    mockDb.update
      .mockReturnValueOnce(makeUpdateChain([updatedGF]))               // score GF
      .mockReturnValueOnce(makeUpdateChain());                         // tournament complete

    const res = await ownerRequest("put", "/api/knockout-matches/302")
      .send({ homeScore: 3, awayScore: 1 });
    expect(res.status).toBe(200);

    // Tournament should be marked complete
    const completedUpdate = updateCalls.find((c) => c.set.status === "completed");
    expect(completedUpdate).toBeDefined();

    // No reset match should be inserted
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("Grand Final — LB champion (away) wins: creates grand_final_reset match, no completion yet", async () => {
    // LB champion (away=T2) beats WB champion (home=T1) in GF → reset required
    const gf = { ...GF_MATCH, homeTeamId: 101, awayTeamId: 102 };
    const updatedGF = { ...gf, homeScore: 1, awayScore: 2, played: true, winnerId: 102 };
    const resetMatch = {
      id: 400, tournamentId: 1, round: "grand_final_reset", matchNumber: 1,
      homeTeamId: 101, awayTeamId: 102, played: false, winnerId: null,
      homeScore: null, awayScore: null, bracket: "grand_final",
      loserDropsToMatchId: null, loserDropsToSlot: null,
    };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([gf]))
      .mockReturnValueOnce(makeSelectChain([DE_ACTIVE_TOUR]))
      .mockReturnValueOnce(makeSelectChain([updatedGF]))
      .mockReturnValueOnce(makeSelectChain(DE_TEAMS));

    mockDb.update
      .mockReturnValueOnce(makeUpdateChain([updatedGF]));              // score GF

    mockDb.insert
      .mockReturnValueOnce(makeInsertChain(resetMatch));               // insert reset match

    const res = await ownerRequest("put", "/api/knockout-matches/302")
      .send({ homeScore: 1, awayScore: 2 });
    expect(res.status).toBe(200);

    // Tournament should NOT be marked complete yet
    const completedUpdate = updateCalls.find((c) => c.set.status === "completed");
    expect(completedUpdate).toBeUndefined();

    // Reset match should be inserted
    expect(mockDb.insert).toHaveBeenCalled();
    const insertArgs = (mockDb.insert.mock.calls[0][0] as any);
    expect(insertArgs).toBeTruthy();
  });

  it("Grand Final Reset: winner of reset match marks tournament complete", async () => {
    // The reset match has bracket='grand_final' and round='grand_final_reset'
    const resetMatch = {
      id: 400, tournamentId: 1, round: "grand_final_reset", matchNumber: 1,
      homeTeamId: 101, awayTeamId: 102, played: false, winnerId: null,
      homeScore: null, awayScore: null, bracket: "grand_final",
      loserDropsToMatchId: null, loserDropsToSlot: null,
    };
    const updatedReset = { ...resetMatch, homeScore: 2, awayScore: 1, played: true, winnerId: 101 };

    addOrganizerCheck();
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([resetMatch]))
      .mockReturnValueOnce(makeSelectChain([DE_ACTIVE_TOUR]))
      .mockReturnValueOnce(makeSelectChain([updatedReset]))
      .mockReturnValueOnce(makeSelectChain(DE_TEAMS));

    mockDb.update
      .mockReturnValueOnce(makeUpdateChain([updatedReset]))            // score reset match
      .mockReturnValueOnce(makeUpdateChain());                         // mark tournament complete

    const res = await ownerRequest("put", "/api/knockout-matches/400")
      .send({ homeScore: 2, awayScore: 1 });
    expect(res.status).toBe(200);

    const completedUpdate = updateCalls.find((c) => c.set.status === "completed");
    expect(completedUpdate).toBeDefined();
  });
});
