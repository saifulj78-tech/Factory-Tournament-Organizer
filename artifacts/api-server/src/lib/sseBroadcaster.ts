/**
 * Lightweight in-process SSE broadcaster.
 * Keeps a set of subscriber callbacks per tournament id.
 * When data changes, call broadcast(tournamentId) — all open SSE connections
 * for that tournament receive a "update" event and re-fetch from their own queries.
 */

export type FixtureChangeNotice = {
  type: "fixture_change";
  message: string;
};

type Listener = (notice?: FixtureChangeNotice) => void;

const listeners = new Map<number, Set<Listener>>();

/** Register a listener for a tournament. Returns an unsubscribe function. */
export function subscribe(tournamentId: number, fn: Listener): () => void {
  if (!listeners.has(tournamentId)) {
    listeners.set(tournamentId, new Set());
  }
  listeners.get(tournamentId)!.add(fn);
  return () => {
    const set = listeners.get(tournamentId);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) listeners.delete(tournamentId);
  };
}

/** Notify all open SSE connections watching this tournament. */
export function broadcast(tournamentId: number, notice?: FixtureChangeNotice): void {
  listeners.get(tournamentId)?.forEach((fn) => fn(notice));
}
