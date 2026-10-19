import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  tournamentTable: { id: "tournament.id", createdBy: "tournament.createdBy", status: "tournament.status", format: "tournament.format" },
  tournamentCoOrganizersTable: { id: "co.id", tournamentId: "co.tournamentId", userId: "co.userId" },
  organizersTable: { email: "organizer.email", expiresAt: "organizer.expiresAt" },
  groupsTable: { id: "group.id", tournamentId: "group.tournamentId", groupNumber: "group.groupNumber" },
  teamsTable: { id: "team.id", groupId: "team.groupId" },
  matchesTable: { id: "match.id", groupId: "match.groupId", roundNumber: "match.roundNumber", courtNumber: "match.courtNumber" },
  knockoutMatchesTable: { id: "knockout.id", tournamentId: "knockout.tournamentId" },
  ladderParticipantsTable: { id: "participant.id", tournamentId: "participant.tournamentId" },
  ladderCourtsTable: { id: "court.id", tournamentId: "court.tournamentId" },
  ladderGamesTable: { id: "game.id", tournamentId: "game.tournamentId" },
  teamEventConfigsTable: { id: "config.id", tournamentId: "config.tournamentId" },
  teamEventRubberTemplatesTable: { id: "template.id", tournamentId: "template.tournamentId" },
  teamEventRubbersTable: { id: "rubber.id", tournamentId: "rubber.tournamentId" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (a: unknown, b: unknown) => ({ type: "eq", a, b }),
    and: (...args: unknown[]) => ({ type: "and", args }),
  };
});

const OWNER = "owner";
const CO_ORGANIZER = "co-organizer";
const OTHER = "other";
const ADMIN = "admin";
const mockGetUser = vi.fn();
const mockGetUserList = vi.fn();

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
        getUserList: mockGetUserList,
        deleteUser: vi.fn(),
      },
      invitations: { createInvitation: vi.fn() },
    }),
  };
});

const { default: app } = await import("../app.js");

function selectRows(rows: unknown[]) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.then = vi.fn((resolve) => Promise.resolve(rows).then(resolve));
  return chain;
}

function mutationRows(rows: unknown[] = []) {
  const chain: any = {};
  chain.set = vi.fn().mockReturnValue(chain);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(rows);
  chain.then = vi.fn((resolve) => Promise.resolve(rows).then(resolve));
  return chain;
}

const tournament = {
  id: 1,
  name: "Shared tournament",
  groupCount: 1,
  teamsPerGroup: 2,
  courtCount: 1,
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  createdBy: OWNER,
  format: "round_robin",
  qualifiersPerGroup: null,
  wildcardQualifiers: 0,
  knockoutFormat: "single",
  thirdPlacePlayoffEnabled: true,
  tiebreakerOrder: "goal_difference,goals_for,goals_against,head_to_head",
};
const group = { id: 10, name: "Group A", groupNumber: 1, tournamentId: 1 };
const team = { id: 20, name: "Team A", groupId: 10 };
const match = {
  id: 30,
  groupId: 10,
  homeTeamId: 20,
  awayTeamId: 21,
  homeScore: null,
  awayScore: null,
  played: false,
  startedAt: null,
  roundNumber: 1,
  courtNumber: 1,
};
const membership = {
  id: 40,
  tournamentId: 1,
  userId: CO_ORGANIZER,
  email: "co@example.com",
  addedAt: new Date("2026-01-02T00:00:00Z"),
};

function api(userId: string, method: "post" | "put" | "delete", path: string) {
  return (request(app) as any)[method](path).set("x-test-user-id", userId);
}

function allowCoOrganizer(...routeRows: unknown[][]) {
  mockDb.select
    .mockReturnValueOnce(selectRows([]))
    .mockReturnValueOnce(selectRows([tournament]))
    .mockReturnValueOnce(selectRows([membership]));
  for (const rows of routeRows) mockDb.select.mockReturnValueOnce(selectRows(rows));
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.ADMIN_EMAIL = "admin@example.com";
  mockGetUser.mockImplementation(async (userId: string) => ({
    id: userId,
    primaryEmailAddressId: "primary",
    emailAddresses: [{
      id: "primary",
      emailAddress: userId === ADMIN ? "admin@example.com" : `${userId}@example.com`,
    }],
  }));
  mockGetUserList.mockResolvedValue({ data: [{ id: CO_ORGANIZER }] });
  mockDb.select.mockReturnValue(selectRows([]));
  mockDb.insert.mockReturnValue(mutationRows([]));
  mockDb.update.mockReturnValue(mutationRows([]));
  mockDb.delete.mockReturnValue(mutationRows([]));
});

describe("co-organizer membership", () => {
  it("lets the owner add an existing signed-in user by email", async () => {
    mockDb.select
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([tournament]))
      .mockReturnValueOnce(selectRows([]));
    mockDb.insert.mockReturnValueOnce(mutationRows([membership]));

    const res = await api(OWNER, "post", "/api/tournaments/1/co-organizers").send({ email: "CO@example.com" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ userId: CO_ORGANIZER, email: "co@example.com" });
  });

  it("rejects duplicate organizer assignment", async () => {
    mockDb.select
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([tournament]))
      .mockReturnValueOnce(selectRows([membership]));

    const res = await api(OWNER, "post", "/api/tournaments/1/co-organizers").send({ email: "co@example.com" });

    expect(res.status).toBe(409);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("lets the owner remove a co-organizer", async () => {
    mockDb.select
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([tournament]));

    const res = await api(OWNER, "delete", `/api/tournaments/1/co-organizers/${CO_ORGANIZER}`);

    expect(res.status).toBe(204);
    expect(mockDb.delete).toHaveBeenCalledOnce();
  });

  it.each([CO_ORGANIZER, OTHER])("does not let %s change organizer membership", async (userId) => {
    mockDb.select
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([tournament]));

    const res = await api(userId, "post", "/api/tournaments/1/co-organizers").send({ email: "co@example.com" });

    expect(res.status).toBe(403);
    expect(mockGetUserList).not.toHaveBeenCalled();
  });
});

describe("co-organizer route access", () => {
  it("can edit tournament settings", async () => {
    allowCoOrganizer();
    mockDb.update.mockReturnValueOnce(mutationRows([{ ...tournament, name: "Updated" }]));

    const res = await api(CO_ORGANIZER, "put", "/api/tournaments/1").send({
      name: "Updated", groupCount: 1, teamsPerGroup: 2, courtCount: 1,
    });

    expect(res.status).toBe(200);
  });

  it("can add teams and matches", async () => {
    allowCoOrganizer([group]);
    mockDb.insert.mockReturnValueOnce(mutationRows([team]));
    const teamRes = await api(CO_ORGANIZER, "post", "/api/tournaments/1/teams").send({ name: "Team A", groupId: 10 });
    expect(teamRes.status).toBe(201);

    allowCoOrganizer([group]);
    mockDb.insert.mockReturnValueOnce(mutationRows([match]));
    mockDb.select.mockReturnValueOnce(selectRows([{ id: 20, name: "Team A" }, { id: 21, name: "Team B" }]));
    const matchRes = await api(CO_ORGANIZER, "post", "/api/tournaments/1/matches").send({
      groupId: 10, homeTeamId: 20, awayTeamId: 21, roundNumber: 1,
    });
    expect(matchRes.status).toBe(201);
  });

  it("can enter scores and complete the tournament", async () => {
    mockDb.select
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([match]))
      .mockReturnValueOnce(selectRows([group]))
      .mockReturnValueOnce(selectRows([tournament]))
      .mockReturnValueOnce(selectRows([membership]))
      .mockReturnValueOnce(selectRows([{ id: 20, name: "Team A" }, { id: 21, name: "Team B" }]));
    mockDb.update.mockReturnValueOnce(mutationRows([{ ...match, homeScore: 2, awayScore: 1, played: true }]));
    const scoreRes = await api(CO_ORGANIZER, "put", "/api/matches/30").send({ homeScore: 2, awayScore: 1, played: true });
    expect(scoreRes.status).toBe(200);

    allowCoOrganizer();
    mockDb.update.mockReturnValueOnce(mutationRows([{ ...tournament, status: "completed" }]));
    const completeRes = await api(CO_ORGANIZER, "post", "/api/tournaments/1/complete");
    expect(completeRes.status).toBe(200);
  });

  it.each([OTHER, CO_ORGANIZER])("returns 403 after membership is absent for %s", async (userId) => {
    mockDb.select
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([tournament]))
      .mockReturnValueOnce(selectRows([]));

    const res = await api(userId, "post", "/api/tournaments/1/complete");

    expect(res.status).toBe(403);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("does not let a co-organizer delete the tournament", async () => {
    mockDb.select
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([tournament]));

    const res = await api(CO_ORGANIZER, "delete", "/api/tournaments/1");

    expect(res.status).toBe(403);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it("lets an admin manage membership and delete the tournament", async () => {
    mockDb.select.mockReturnValueOnce(selectRows([tournament])).mockReturnValueOnce(selectRows([]));
    mockDb.insert.mockReturnValueOnce(mutationRows([membership]));
    const addRes = await api(ADMIN, "post", "/api/tournaments/1/co-organizers").send({ email: "co@example.com" });
    expect(addRes.status).toBe(201);

    mockDb.select.mockReturnValueOnce(selectRows([tournament])).mockReturnValueOnce(selectRows([]));
    const deleteRes = await api(ADMIN, "delete", "/api/tournaments/1");
    expect(deleteRes.status).toBe(204);
  });
});