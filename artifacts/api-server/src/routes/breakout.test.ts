import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const tables = {
  tournamentTable: { key: "tournament", id: "id" },
  groupsTable: { key: "groups", id: "id", tournamentId: "tournamentId" },
  teamsTable: { key: "teams", id: "id", groupId: "groupId" },
  matchesTable: { key: "matches", groupId: "groupId" },
  knockoutMatchesTable: { key: "legacy", tournamentId: "tournamentId" },
  breakoutKnockoutsTable: { key: "breakout", id: "id", tournamentId: "tournamentId", position: "position" },
};
let rows: Record<string, any[]> = {};
let nextId = 100;
const getSorted = vi.fn();
const getPlayoff = vi.fn();
const getThirdPlace = vi.fn();
type Predicate = (row: any) => boolean;

function chain(kind: string, table?: { key: string }) {
  let filter: Predicate = () => true;
  let input: any;
  let source = table;
  const run = () => {
    const key = source!.key;
    if (kind === "select") return rows[key].filter(filter);
    if (kind === "delete") { rows[key] = rows[key].filter((row) => !filter(row)); return []; }
    if (kind === "insert") {
      const inserted = (Array.isArray(input) ? input : [input]).map((row) => ({
        id: nextId++, seeds: [], scores: {}, ...row,
      }));
      rows[key].push(...inserted);
      return inserted;
    }
    const selected = rows[key].filter(filter);
    selected.forEach((row) => Object.assign(row, input));
    return selected;
  };
  const result: any = {
    from: (value: { key: string }) => { source = value; return result; },
    where: (value: Predicate) => { filter = value; return result; },
    orderBy: () => result,
    values: (value: any) => { input = value; return result; },
    set: (value: any) => { input = value; return result; },
    returning: async () => run(),
    then: (resolve: (value: any) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
  };
  return result;
}
const mockDb: any = {
  select: () => chain("select"),
  delete: (table: any) => chain("delete", table),
  insert: (table: any) => chain("insert", table),
  update: (table: any) => chain("update", table),
  execute: async () => [],
  transaction: async (action: (tx: any) => Promise<any>) => {
    const old = structuredClone(rows);
    try { return await action(mockDb); } catch (error) { rows = old; throw error; }
  },
};
vi.mock("@workspace/db", () => ({ db: mockDb, ...tables }));
vi.mock("drizzle-orm", () => ({
  eq: (field: string, value: any) => (row: any) => row[field] === value,
  inArray: (field: string, values: any[]) => (row: any) => values.includes(row[field]),
  and: (...conditions: Predicate[]) => (row: any) => conditions.every((condition) => condition(row)),
  sql: () => null,
}));
vi.mock("./tournament", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.userId = req.headers["x-test-user"];
    if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    next();
  },
  isAdminUser: async () => false,
  canManageTournament: async (tournament: any, userId: string) => tournament.createdBy === userId,
  getSortedQualifiers: getSorted,
  getWildcardPlayoffState: getPlayoff,
  getThirdPlaceTeams: getThirdPlace,
}));
vi.mock("../lib/sseBroadcaster", () => ({ broadcast: vi.fn() }));

const { default: router } = await import("./breakout");
const app = express().use(express.json()).use("/api", router);
app.use((error: Error, _req: any, res: any, _next: any) => res.status(500).json({ error: error.message }));
const base = "/api/tournaments/1/breakout-knockouts";
const write = (method: "put" | "post" | "delete", url = base, user = "owner") => request(app)[method](url).set("x-test-user", user);
const config = { enabled: true, brackets: [{ name: "North", groupIds: [10] }, { name: "South", groupIds: [20] }] };

beforeEach(() => {
  nextId = 100;
  rows = {
    tournament: [{ id: 1, createdBy: "owner", status: "active", format: "round_robin", teamsPerGroup: 4, qualifiersPerGroup: 4, wildcardQualifiers: 0, wildcardSelectionMethod: "ranking" }],
    groups: [{ id: 10, tournamentId: 1, name: "Group A", groupNumber: 1 }, { id: 20, tournamentId: 1, name: "Group B", groupNumber: 2 }, { id: 99, tournamentId: 2, name: "Foreign", groupNumber: 1 }],
    teams: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, groupId: i < 4 ? 10 : 20, name: `Team ${i + 1}` })),
    matches: [{ groupId: 10, homeTeamId: 1, awayTeamId: 2, played: true, homeScore: 21, awayScore: 11 }, { groupId: 20, homeTeamId: 5, awayTeamId: 6, played: true, homeScore: 21, awayScore: 11 }],
    legacy: [], breakout: [],
  };
  getSorted.mockReset().mockImplementation(async (tournament: any) => {
    const groups = rows.groups.filter((group) => group.tournamentId === tournament.id);
    return Array.from({ length: tournament.qualifiersPerGroup }, (_, position) =>
      groups.flatMap((group, groupIndex) => {
        const team = rows.teams.filter((entry) => entry.groupId === group.id)[position];
        return team ? [{ teamId: team.id, teamName: team.name, groupIndex, position }] : [];
      })).flat();
  });
  getPlayoff.mockReset().mockResolvedValue({ matches: [], qualifiedTeamIds: null, tieAtCutoff: false });
  getThirdPlace.mockReset().mockResolvedValue({ candidates: [] });
});

describe("breakout knockout routes", () => {
  it("requires six qualifiers in each Top 6 breakout, without advancing extra teams", async () => {
    Object.assign(rows.tournament[0], { knockoutFormat: "top6" });
    await write("put").send({ enabled: true, brackets: [{ name: "North", groupIds: [10] }, { name: "South", groupIds: [20] }] });
    const preview = await request(app).get(base);
    expect(preview.body.knockoutFormat).toBe("top6");
    expect(preview.body.qualificationReady).toBe(false);
    expect(preview.body.qualificationMessage).toContain("exactly six");
    expect((await write("post", `${base}/generate`)).status).toBe(409);
    expect(rows.breakout.every((bracket) => bracket.seeds.length === 0)).toBe(true);
    rows.teams.push(
      { id: 9, groupId: 10, name: "Team 9" }, { id: 10, groupId: 10, name: "Team 10" },
      { id: 11, groupId: 20, name: "Team 11" }, { id: 12, groupId: 20, name: "Team 12" },
    );
    Object.assign(rows.tournament[0], { qualifiersPerGroup: 6, teamsPerGroup: 6 });
    const generated = await write("post", `${base}/generate`);
    expect(generated.status).toBe(201);
    expect(rows.breakout.map((bracket) => bracket.seeds.length)).toEqual([6, 6]);
    for (const bracket of generated.body.brackets) {
      expect(bracket.matches.filter((match: any) => match.round === 1 && match.bye).map((match: any) => match.winnerId))
        .toEqual(bracket.qualifiers.slice(0, 2).map((qualifier: any) => qualifier.teamId));
      expect(bracket.matches.filter((match: any) => match.round === 1 && !match.bye)).toHaveLength(2);
    }
  });

  it("rejects a manual Top 6 override unless both brackets contain exactly six distinct teams", async () => {
    Object.assign(rows.tournament[0], { knockoutFormat: "top6" });
    await write("put").send({ enabled: true, brackets: [{ name: "North", groupIds: [10] }, { name: "South", groupIds: [20] }] });
    const response = await write("post", `${base}/generate`).send({ brackets: [
      { bracketId: rows.breakout[0].id, qualifierTeamIds: [1, 2, 3, 4] },
      { bracketId: rows.breakout[1].id, qualifierTeamIds: [5, 6, 7, 8] },
    ] });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("exactly six");
    expect(rows.breakout.every((bracket) => bracket.seeds.length === 0)).toBe(true);
  });

  it("waits for the configured third-place playoff and routes its winners by source group", async () => {
    rows.groups.push({ id: 30, tournamentId: 1, groupNumber: 3, name: "Group C" });
    rows.teams.push(...Array.from({ length: 4 }, (_, i) => ({ id: i + 9, groupId: 30, name: `Team ${i + 9}` })));
    Object.assign(rows.tournament[0], { qualifiersPerGroup: 2, wildcardQualifiers: 2, wildcardSelectionMethod: "round_robin" });
    await write("put").send({ enabled: true, brackets: [{ name: "North", groupIds: [10] }, { name: "South", groupIds: [20, 30] }] });
    expect((await request(app).get(base)).body.qualificationReady).toBe(false);
    expect((await write("post", `${base}/generate`)).status).toBe(409);
    getPlayoff.mockResolvedValue({
      qualifiedTeamIds: [3, 7], tieAtCutoff: false,
      matches: [{ homeTeamId: 3, awayTeamId: 7 }, { homeTeamId: 3, awayTeamId: 11 }, { homeTeamId: 7, awayTeamId: 11 }],
    });
    getThirdPlace.mockResolvedValue({ candidates: [{ teamId: 4 }, { teamId: 7 }, { teamId: 11 }] });
    expect((await write("post", `${base}/generate`)).status).toBe(409);
    getThirdPlace.mockResolvedValue({ candidates: [{ teamId: 3 }, { teamId: 7 }, { teamId: 11 }] });
    const generated = await write("post", `${base}/generate`);
    expect(generated.status).toBe(201);
    expect(rows.breakout.map((bracket) => bracket.seeds)).toEqual([[1, 2, 3], [5, 9, 6, 10, 7]]);
  });
  it("uses only configured qualifiers, in existing seed order, not every selected-group team", async () => {
    rows.tournament[0].qualifiersPerGroup = 2;
    getSorted.mockResolvedValue([
      { teamId: 3, teamName: "Team 3", groupIndex: 0, position: 0 },
      { teamId: 8, teamName: "Team 8", groupIndex: 1, position: 0 },
      { teamId: 2, teamName: "Team 2", groupIndex: 0, position: 1 },
      { teamId: 6, teamName: "Team 6", groupIndex: 1, position: 1 },
    ]);
    const configured = await write("put").send(config);
    expect(configured.body.brackets.map((bracket: any) => bracket.qualifiers.map((qualifier: any) => qualifier.teamId))).toEqual([[3, 2], [8, 6]]);
    const generated = await write("post", `${base}/generate`);
    expect(generated.status).toBe(201);
    expect(rows.breakout.map((bracket) => bracket.seeds)).toEqual([[3, 2], [8, 6]]);
  });

  it("blocks automatic qualification until fixtures have been scored", async () => {
    rows.matches[0].played = false;
    const configured = await write("put").send(config);
    expect(configured.body.qualificationReady).toBe(false);
    expect((await write("post", `${base}/generate`)).status).toBe(409);
    expect(rows.breakout.every((bracket) => bracket.seeds.length === 0)).toBe(true);
  });

  it("keeps the explicit manual qualifier override and rejects a team from the other bracket", async () => {
    rows.matches[0].played = false;
    await write("put").send(config);
    const [first, second] = rows.breakout;
    const manual = { brackets: [{ bracketId: first.id, qualifierTeamIds: [4, 1] }, { bracketId: second.id, qualifierTeamIds: [8, 5] }] };
    const invalid = structuredClone(manual);
    invalid.brackets[0].qualifierTeamIds = [4, 5];
    expect((await write("post", `${base}/generate`).send(invalid)).status).toBe(400);
    const generated = await write("post", `${base}/generate`).send(manual);
    expect(generated.status).toBe(201);
    expect(generated.body.brackets.map((bracket: any) => bracket.qualifiers.map((qualifier: any) => qualifier.teamId))).toEqual([[4, 1], [8, 5]]);
    expect(rows.breakout.map((bracket) => bracket.seeds)).toEqual([[4, 1], [8, 5]]);
  });
  it("configures selected groups, generates two draws and publishes two independent champions", async () => {
    expect((await write("put").send(config)).status).toBe(200);
    const generated = await write("post", `${base}/generate`);
    expect(generated.status).toBe(201);
    expect(generated.body.brackets).toHaveLength(2);
    for (const bracket of generated.body.brackets) {
      let current = bracket;
      for (let round = 0; round < 3; round++) {
        for (const match of current.matches.filter((match: any) => match.ready && !match.played && !match.bye)) {
          const response = await write("put", `${base}/${bracket.id}/matches/${match.id}`).send({ homeScore: 21, awayScore: 11 });
          expect(response.status).toBe(200);
          current = response.body.brackets.find((entry: any) => entry.id === bracket.id);
        }
      }
    }
    const result = await request(app).get(base);
    expect(result.status).toBe(200);
    expect(result.body.brackets.map((bracket: any) => bracket.winnerTeamId)).toEqual([1, 5]);
    const [first, second] = result.body.brackets;
    const correction = await write("put", `${base}/${first.id}/matches/1`).send({ homeScore: 1, awayScore: 21 });
    expect(correction.body.brackets[0].winnerTeamId).toBeNull();
    expect(correction.body.brackets[1]).toEqual(second);
    expect((await write("put").send({ enabled: false, brackets: [] })).status).toBe(409);
    const reset = await write("delete", `${base}/matches`);
    expect(reset.body.brackets.every((bracket: any) => bracket.matches.length === 0)).toBe(true);
    expect(reset.body.enabled).toBe(true);
    expect((await write("put").send({ enabled: false, brackets: [] })).body.enabled).toBe(false);
  });

  it("rejects overlapping, empty, foreign groups and blank or identical bracket names", async () => {
    for (const brackets of [
      [{ name: "One", groupIds: [10] }, { name: "Two", groupIds: [10] }],
      [{ name: "One", groupIds: [10] }, { name: "Two", groupIds: [99] }],
      [{ name: "One", groupIds: [] }, { name: "Two", groupIds: [20] }],
      [{ name: " ", groupIds: [10] }, { name: "Two", groupIds: [20] }],
      [{ name: "Same", groupIds: [10] }, { name: "same", groupIds: [20] }],
    ]) expect((await write("put").send({ enabled: true, brackets })).status).toBe(400);
    expect(rows.breakout).toHaveLength(0);
  });

  it("rejects ties, waiting games, foreign brackets and fractional scores", async () => {
    await write("put").send(config);
    const generated = await write("post", `${base}/generate`);
    const bracket = generated.body.brackets[0];
    expect((await write("put", `${base}/${bracket.id}/matches/1`).send({ homeScore: 2, awayScore: 2 })).status).toBe(400);
    expect((await write("put", `${base}/${bracket.id}/matches/1`).send({ homeScore: 2.5, awayScore: 1 })).status).toBe(400);
    expect((await write("put", `${base}/${bracket.id}/matches/3`).send({ homeScore: 21, awayScore: 10 })).status).toBe(409);
    expect((await write("put", `${base}/999/matches/1`).send({ homeScore: 21, awayScore: 10 })).status).toBe(404);
  });

  it("does not partially generate when one selected bracket has too few teams", async () => {
    await write("put").send(config);
    rows.teams = rows.teams.filter((team) => team.groupId === 10 || team.id === 5);
    expect((await write("post", `${base}/generate`)).status).toBe(409);
    expect(rows.breakout.every((bracket) => bracket.seeds.length === 0)).toBe(true);
  });

  it("requires management access and refuses changes to completed or incompatible tournaments", async () => {
    expect((await request(app).put(base).send(config)).status).toBe(401);
    expect((await write("put", base, "other").send(config)).status).toBe(403);
    rows.tournament[0].status = "completed";
    expect((await write("put").send(config)).status).toBe(409);
    rows.tournament[0].status = "active";
    rows.tournament[0].format = "individual_ladder";
    expect((await write("put").send(config)).status).toBe(409);
  });

  it("renames a group without changing its ID, teams or fixture membership", async () => {
    const before = structuredClone(rows.teams);
    const response = await write("put", "/api/groups/10").send({ name: "  North division  " });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 10, name: "North division", tournamentId: 1 });
    expect(rows.teams).toEqual(before);
    expect((await write("put", "/api/groups/10").send({ name: "  " })).status).toBe(400);
    expect((await write("put", "/api/groups/10", "other").send({ name: "Wrong" })).status).toBe(403);
  });
});
