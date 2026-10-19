/**
 * Tests for POST /api/admin/tournaments/:id/assign-owner
 *
 * Covers:
 * - Successful assignment of an orphaned tournament
 * - Non-admin rejection (403)
 * - Tournament not found (404)
 * - Target Clerk user not found (404)
 * - Refusal to overwrite an already-owned tournament (409)
 * - Race-condition guard (concurrent assignment)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Database mock ───────────────────────────────────────────────────────────
// Must be declared before the module that imports it is loaded.
const mockDb = {
  select: vi.fn(),
  update: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  tournamentTable: { id: "id", createdBy: "created_by", createdAt: "created_at" },
  groupsTable: {},
  teamsTable: {},
  matchesTable: {},
}));

// ── Drizzle ORM helpers mock ─────────────────────────────────────────────────
// Capture the WHERE arguments passed to update() so tests can assert both predicates.
export const capturedWhere: { conditions: unknown[] } = { conditions: [] };

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (a: unknown, b: unknown) => ({ type: "eq", a, b }),
    isNull: (a: unknown) => ({ type: "isNull", a }),
    inArray: actual.inArray,
    and: (...args: unknown[]) => {
      capturedWhere.conditions = args as unknown[];
      return { type: "and", args };
    },
  };
});

// ── Clerk mock ───────────────────────────────────────────────────────────────
const ADMIN_USER_ID = "user_admin";
const ADMIN_EMAIL = "admin@example.com";
const REGULAR_USER_ID = "user_regular";
const TARGET_USER_ID = "user_organizer";

const mockGetUser = vi.fn();

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkMiddleware: () => (req: any, _res: any, next: any) => {
      // Attach Clerk auth state so getAuth works
      req.auth = { userId: req.headers["x-test-user-id"] ?? null };
      next();
    },
    getAuth: (req: any) => req.auth ?? { userId: null },
    createClerkClient: () => ({
      users: {
        getUser: mockGetUser,
        getUserList: vi.fn().mockResolvedValue({ data: [] }),
        deleteUser: vi.fn().mockResolvedValue(undefined),
      },
      invitations: { createInvitation: vi.fn() },
    }),
  };
});

// ── Load app after mocks are registered ────────────────────────────────────
// Dynamic import ensures mocks are in place before module evaluation.
const { default: app } = await import("../app.js");

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeSelectChain(rows: unknown[]) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
  chain[Symbol.iterator] = undefined;
  // Make it awaitable as an array
  Object.defineProperty(chain, Symbol.toStringTag, { value: "Promise" });
  // Resolve as array when awaited
  chain.then = vi.fn((fn: (v: unknown) => unknown) => Promise.resolve(rows).then(fn));
  return chain;
}

function makeUpdateChain(rows: unknown[]) {
  const chain: any = {};
  chain.set = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(rows);
  return chain;
}

function adminRequest(method: "get" | "post" | "delete", path: string) {
  return (request(app) as any)[method](path).set("x-test-user-id", ADMIN_USER_ID);
}

function regularRequest(method: "get" | "post" | "delete", path: string) {
  return (request(app) as any)[method](path).set("x-test-user-id", REGULAR_USER_ID);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("POST /api/admin/tournaments/:id/assign-owner", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: admin user lookup returns admin email
    mockGetUser.mockImplementation((userId: string) => {
      if (userId === ADMIN_USER_ID) {
        return Promise.resolve({
          id: ADMIN_USER_ID,
          emailAddresses: [{ id: "ea_1", emailAddress: ADMIN_EMAIL }],
          primaryEmailAddressId: "ea_1",
        });
      }
      if (userId === TARGET_USER_ID) {
        return Promise.resolve({
          id: TARGET_USER_ID,
          emailAddresses: [{ id: "ea_2", emailAddress: "organizer@example.com" }],
          primaryEmailAddressId: "ea_2",
        });
      }
      return Promise.reject(new Error("Not found"));
    });

    // Default env: admin email matches
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  });

  it("assigns ownership of an orphaned tournament", async () => {
    const orphaned = { id: 1, name: "Old Tourney", status: "active", createdBy: null, createdAt: new Date() };
    const owned = { ...orphaned, createdBy: TARGET_USER_ID };

    // First select: fetch existing tournament
    mockDb.select.mockReturnValueOnce(makeSelectChain([orphaned]));
    mockDb.update.mockReturnValueOnce(makeUpdateChain([owned]));

    const res = await adminRequest("post", "/api/admin/tournaments/1/assign-owner")
      .send({ userId: TARGET_USER_ID });

    expect(res.status).toBe(200);
    expect(res.body.createdBy).toBe(TARGET_USER_ID);

    // Verify the UPDATE WHERE clause contains BOTH the id predicate and the isNull predicate
    // (guards against the && vs and() bug that would update all orphaned rows)
    expect(capturedWhere.conditions).toHaveLength(2);
    const [idPred, nullPred] = capturedWhere.conditions as Array<{ type: string }>;
    expect(idPred.type).toBe("eq");
    expect(nullPred.type).toBe("isNull");
  });

  it("returns 403 for non-admin users", async () => {
    // Regular user lookup — not admin email
    mockGetUser.mockImplementation((userId: string) => {
      if (userId === REGULAR_USER_ID) {
        return Promise.resolve({
          id: REGULAR_USER_ID,
          emailAddresses: [{ id: "ea_r", emailAddress: "regular@example.com" }],
          primaryEmailAddressId: "ea_r",
        });
      }
      return Promise.reject(new Error("Not found"));
    });

    const res = await regularRequest("post", "/api/admin/tournaments/1/assign-owner")
      .send({ userId: TARGET_USER_ID });

    expect(res.status).toBe(403);
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app)
      .post("/api/admin/tournaments/1/assign-owner")
      .send({ userId: TARGET_USER_ID });

    expect(res.status).toBe(401);
  });

  it("returns 404 when tournament does not exist", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([]));

    const res = await adminRequest("post", "/api/admin/tournaments/999/assign-owner")
      .send({ userId: TARGET_USER_ID });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 409 when tournament already has an owner", async () => {
    const alreadyOwned = { id: 2, name: "Taken", status: "active", createdBy: "someone_else", createdAt: new Date() };
    mockDb.select.mockReturnValueOnce(makeSelectChain([alreadyOwned]));

    const res = await adminRequest("post", "/api/admin/tournaments/2/assign-owner")
      .send({ userId: TARGET_USER_ID });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already has an owner/i);
  });

  it("returns 409 when concurrent assignment wins the race", async () => {
    // Tournament appears unowned in the check but UPDATE returns no rows (race lost)
    const orphaned = { id: 3, name: "Race", status: "active", createdBy: null, createdAt: new Date() };
    mockDb.select.mockReturnValueOnce(makeSelectChain([orphaned]));
    mockDb.update.mockReturnValueOnce(makeUpdateChain([])); // no row updated

    const res = await adminRequest("post", "/api/admin/tournaments/3/assign-owner")
      .send({ userId: TARGET_USER_ID });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already has an owner/i);
  });

  it("returns 404 when target Clerk user does not exist", async () => {
    const orphaned = { id: 4, name: "Orphan", status: "active", createdBy: null, createdAt: new Date() };
    mockDb.select.mockReturnValueOnce(makeSelectChain([orphaned]));

    // Override: admin lookups still work but target user not found
    mockGetUser.mockImplementation((userId: string) => {
      if (userId === ADMIN_USER_ID) {
        return Promise.resolve({
          id: ADMIN_USER_ID,
          emailAddresses: [{ id: "ea_1", emailAddress: ADMIN_EMAIL }],
          primaryEmailAddressId: "ea_1",
        });
      }
      return Promise.reject(new Error("Not found"));
    });

    const res = await adminRequest("post", "/api/admin/tournaments/4/assign-owner")
      .send({ userId: "nonexistent_user" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  it("returns 400 when userId is missing from the request body", async () => {
    const orphaned = { id: 5, name: "Orphan", status: "active", createdBy: null, createdAt: new Date() };
    mockDb.select.mockReturnValueOnce(makeSelectChain([orphaned]));

    const res = await adminRequest("post", "/api/admin/tournaments/5/assign-owner")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userId/i);
  });
});
