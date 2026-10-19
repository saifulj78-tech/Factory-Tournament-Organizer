import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBreakoutKnockouts,
  getGetBreakoutKnockoutsQueryKey,
  useConfigureBreakoutKnockouts,
  useGenerateBreakoutKnockouts,
  useResetBreakoutKnockouts,
  useUpdateBreakoutKnockoutScore,
  getGetTournamentByIdQueryKey,
  getListKnockoutMatchesQueryKey,
  type BreakoutBracket,
  type BreakoutMatch,
  type BreakoutState,
  type BreakoutQualifier,
  type Group,
  type Team,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Top6Info, isTop6VirtualBye } from "./Top6Info";
import { AlertCircle, AlertTriangle, ArrowDown, ArrowUp, Check, ListOrdered, Plus, Edit2, Eraser, GitBranch, Lock, RefreshCw, RotateCcw, Trophy, X } from "lucide-react";

export const BREAKOUT_POLL_MS = 15_000;

export function errorMessage(err: unknown, fallback: string): string {
  const e = err as { data?: { error?: string; message?: string }; message?: string } | null;
  return e?.data?.error ?? e?.data?.message ?? e?.message ?? fallback;
}

export function isGroupBasedFormat(format?: string | null): boolean {
  return format === "round_robin" || format === "group_knockout";
}

/** Shared breakout query with a 15s polling fallback. */
export function useBreakoutState(tournamentId: number, enabled: boolean) {
  return useGetBreakoutKnockouts(tournamentId, {
    query: {
      queryKey: getGetBreakoutKnockoutsQueryKey(tournamentId),
      enabled: enabled && Number.isFinite(tournamentId),
      refetchInterval: enabled ? BREAKOUT_POLL_MS : false,
    },
  });
}

function roundLabel(round: number, maxRound: number): string {
  const fromEnd = maxRound - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

function hasGenerated(state?: BreakoutState | null) {
  return !!state?.brackets.some((b) => b.matches.length > 0);
}

/* ───────────────────────── Settings: configuration ───────────────────────── */

export function BreakoutConfigCard({ tournamentId, groups, format }: { tournamentId: number; groups: Group[]; format: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: state, isLoading, isError, refetch } = useBreakoutState(tournamentId, true);
  const locked = hasGenerated(state);

  const [enabled, setEnabled] = useState(false);
  const [names, setNames] = useState<[string, string]>(["Gold Bracket", "Silver Bracket"]);
  const [assign, setAssign] = useState<Record<number, 0 | 1 | null>>({});
  const [initFor, setInitFor] = useState<string | null>(null);

  const sortedGroups = useMemo(() => [...groups].sort((a, b) => a.groupNumber - b.groupNumber), [groups]);

  useEffect(() => {
    if (!state) return;
    const sig = JSON.stringify(state.brackets.map((b) => [b.name, b.groupIds])) + state.enabled;
    if (sig === initFor) return;
    setInitFor(sig);
    setEnabled(state.enabled);
    if (state.brackets.length === 2) setNames([state.brackets[0].name, state.brackets[1].name]);
    const next: Record<number, 0 | 1 | null> = {};
    state.brackets.slice(0, 2).forEach((b, i) => b.groupIds.forEach((g) => { next[g] = i as 0 | 1; }));
    setAssign(next);
  }, [state, initFor]);

  const configure = useConfigureBreakoutKnockouts({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetBreakoutKnockoutsQueryKey(tournamentId), data);
        queryClient.invalidateQueries({ queryKey: getGetTournamentByIdQueryKey(tournamentId) });
        toast({ title: data.enabled ? "Breakout knockouts saved" : "Breakout knockouts disabled" });
      },
      onError: (err) => toast({ title: "Could not save breakouts", description: errorMessage(err, "Please check the configuration."), variant: "destructive" }),
    },
  });

  const groupsFor = (i: 0 | 1) => sortedGroups.filter((g) => assign[g.id] === i).map((g) => g.id);
  const trimmed = names.map((n) => n.trim());
  const problems: string[] = [];
  if (enabled) {
    trimmed.forEach((n, i) => { if (n.length < 1 || n.length > 80) problems.push(`Bracket ${i + 1} needs a name of 1–80 characters.`); });
    if (trimmed[0] && trimmed[0].toLowerCase() === trimmed[1].toLowerCase()) problems.push("Bracket names should be different.");
    ([0, 1] as const).forEach((i) => { if (groupsFor(i).length === 0) problems.push(`Assign at least one group to ${trimmed[i] || `bracket ${i + 1}`}.`); });
  }

  const save = () => {
    if (problems.length) return;
    configure.mutate({
      id: tournamentId,
      data: enabled
        ? { enabled: true, brackets: [0, 1].map((i) => ({ name: trimmed[i], groupIds: groupsFor(i as 0 | 1) })) }
        : { enabled: false, brackets: [] },
    });
  };

  return (
    <Card className="bg-card border border-border" data-testid="card-breakout-config">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="display-font text-xl tracking-wide text-primary flex items-center gap-2">
            <GitBranch className="w-5 h-5" /> BREAKOUT KNOCKOUTS
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Run two independent knockout brackets (single elimination or Top 6 Playoff, chosen in the tournament settings above and shared by both). Qualifiers are chosen with the tournament's normal criteria first (qualifiers per group, wildcard places and ranking, tiebreakers and any third-place playoff), then each qualifier is sent to the bracket that owns its group. Each bracket crowns its own champion.
          </p>
        </div>
        {locked && <Badge variant="outline" className="border-primary/40 text-primary shrink-0"><Lock className="w-3 h-3 mr-1" />Locked</Badge>}
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading breakout configuration">
            <Skeleton className="h-10 bg-background" /><Skeleton className="h-28 bg-background" />
          </div>
        ) : isError ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-destructive" />Could not load breakout configuration.</span>
            <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-retry-breakout-config"><RefreshCw className="w-3.5 h-3.5 mr-1" />Retry</Button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground border-l-2 border-primary/50 pl-3">
              Set qualifiers per group and wildcard rules in the tournament settings above; they apply to both brackets. Only qualifying teams take part, not every team in a group. Each bracket needs at least 2 qualifiers.
              {format === "group_knockout" && " Breakouts take the place of the single knockout bracket, and enabling is refused while a legacy bracket exists, so reset that from Matches first."}
            </p>
            <label className={`flex items-center gap-3 rounded-md border p-3 ${locked ? "opacity-60" : "cursor-pointer"} ${enabled ? "border-primary bg-primary/10" : "border-border bg-background/50"}`}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={enabled}
                disabled={locked}
                onChange={(e) => setEnabled(e.target.checked)}
                data-testid="checkbox-breakout-enabled"
              />
              <span className="text-sm font-semibold">Run two breakout knockouts after the group stage</span>
            </label>

            {enabled && (
              sortedGroups.length < 2 ? (
                <p className="text-sm text-muted-foreground rounded-md border border-dashed border-border p-4">
                  Generate at least two groups before assigning breakout brackets.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {([0, 1] as const).map((i) => (
                    <div key={i} className="rounded-md border border-border bg-background/40 p-3 space-y-3">
                      <div className="space-y-1">
                        <label htmlFor={`breakout-name-${i}`} className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Bracket {i + 1} name</label>
                        <Input
                          id={`breakout-name-${i}`}
                          value={names[i]}
                          maxLength={80}
                          disabled={locked}
                          onChange={(e) => setNames((p) => (i === 0 ? [e.target.value, p[1]] : [p[0], e.target.value]))}
                          className="bg-background border-border"
                          data-testid={`input-breakout-name-${i}`}
                        />
                      </div>
                      <fieldset className="space-y-1.5">
                        <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Groups</legend>
                        {sortedGroups.map((g) => {
                          const other = assign[g.id] === (i === 0 ? 1 : 0);
                          const checked = assign[g.id] === i;
                          return (
                            <label key={g.id} className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${other ? "opacity-40" : "hover:bg-muted/40 cursor-pointer"}`}>
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-[hsl(var(--primary))]"
                                checked={checked}
                                disabled={locked || other}
                                onChange={(e) => setAssign((p) => ({ ...p, [g.id]: e.target.checked ? i : null }))}
                                data-testid={`checkbox-breakout-${i}-group-${g.id}`}
                              />
                              <span className="truncate">{g.name}</span>
                              {other && <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">in {trimmed[i === 0 ? 1 : 0] || "other"}</span>}
                            </label>
                          );
                        })}
                      </fieldset>
                    </div>
                  ))}
                </div>
              )
            )}

            {enabled && problems.length > 0 && !locked && (
              <ul className="text-xs text-amber-400 space-y-0.5" aria-live="polite">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}

            {locked ? (
              <p className="text-xs text-muted-foreground flex items-center gap-2"><Lock className="w-3.5 h-3.5" />Brackets have been generated. Reset them from Matches to change the configuration.</p>
            ) : (
              <div className="flex justify-end">
                <Button
                  onClick={save}
                  disabled={configure.isPending || problems.length > 0 || (enabled && sortedGroups.length < 2)}
                  className="bg-primary text-primary-foreground font-bold uppercase tracking-wider text-xs"
                  data-testid="button-save-breakout"
                >
                  {configure.isPending ? "Saving…" : "Save breakout setup"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── Bracket panel ───────────────────────── */

function MatchCard({
  match, bracket, organizer, tournamentId,
}: { match: BreakoutMatch; bracket: BreakoutBracket; organizer: boolean; tournamentId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [confirmAction, setConfirmAction] = useState<"clear" | "correct" | null>(null);

  useEffect(() => {
    setEditing(false);
    setHome("");
    setAway("");
    setConfirmAction(null);
  }, [match.homeTeamId, match.awayTeamId]);

  const update = useUpdateBreakoutKnockoutScore({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetBreakoutKnockoutsQueryKey(tournamentId), data);
        queryClient.invalidateQueries({ queryKey: getGetTournamentByIdQueryKey(tournamentId) });
        setEditing(false);
        setConfirmAction(null);
      },
      onError: (err) => toast({ title: "Score not saved", description: errorMessage(err, "Please try again."), variant: "destructive" }),
    },
  });

  const canScore = organizer && match.ready && !match.bye && match.homeTeamId != null && match.awayTeamId != null;
  const h = Number(home), a = Number(away);
  const valid = home !== "" && away !== "" && Number.isSafeInteger(h) && Number.isSafeInteger(a) &&
    h >= 0 && a >= 0 && h <= 2147483647 && a <= 2147483647 && h !== a;

  const save = () => {
    if (!valid) return;
    update.mutate({ id: tournamentId, bracketId: bracket.id, matchId: match.id, data: { homeScore: h, awayScore: a } }, {
      onSuccess: () => toast({ title: "Score saved", description: "Later results in this bracket may have been cleared if the winner changed." }),
    });
  };
  const submit = () => {
    if (!valid) return;
    const newWinner = h > a ? match.homeTeamId : match.awayTeamId;
    if (match.played && newWinner !== match.winnerId && bracket.matches.some((later) => later.round > match.round && later.played)) {
      setConfirmAction("correct");
      return;
    }
    save();
  };
  const clear = () => {
    update.mutate({ id: tournamentId, bracketId: bracket.id, matchId: match.id, data: { homeScore: null, awayScore: null } }, {
      onSuccess: () => toast({ title: "Result cleared" }),
    });
  };

  const row = (name: string | null, teamId: number | null, score: number | null) => {
    const won = match.winnerId != null && match.winnerId === teamId;
    const lost = match.played && match.winnerId != null && teamId != null && !won;
    return (
      <div className={`flex items-center justify-between gap-2 px-3 py-1.5 ${won ? "bg-primary/10" : ""}`}>
        <span className={`truncate text-sm ${won ? "font-bold text-primary" : lost ? "text-muted-foreground line-through decoration-1" : name ? "text-foreground" : "text-muted-foreground italic"}`}>
          {name ?? (match.bye ? "Bye" : "TBD")}
        </span>
        <span className={`mono-font text-sm ${won ? "text-primary font-bold" : "text-muted-foreground"}`}>{score ?? "–"}</span>
      </div>
    );
  };

  return (
    <div className="w-56 shrink-0 rounded-md border border-border bg-background/60 overflow-hidden" data-testid={`card-breakout-match-${bracket.id}-${match.id}`}>
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Match {match.matchNumber}</span>
        {match.bye ? <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Bye</span>
          : match.played ? <span className="text-[10px] uppercase tracking-wider text-green-400">Final</span>
          : match.ready ? <span className="text-[10px] uppercase tracking-wider text-primary">Ready</span>
          : <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Waiting</span>}
      </div>
      {editing ? (
        <div className="p-3 space-y-3">
          {([["home", match.homeTeamName, home, setHome], ["away", match.awayTeamName, away, setAway]] as const).map(([k, n, v, set]) => (
            <div key={k} className="flex items-center gap-2">
              <label htmlFor={`bk-${bracket.id}-${match.id}-${k}`} className="flex-1 min-w-0 text-sm break-words">{n}</label>
              <Input
                id={`bk-${bracket.id}-${match.id}-${k}`}
                type="number" min={0} max={2147483647} step={1} inputMode="numeric"
                value={v}
                onChange={(e) => set(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setEditing(false); }}
                className="h-12 w-20 shrink-0 bg-background border-border text-center text-base mono-font"
                data-testid={`input-breakout-${k}-${bracket.id}-${match.id}`}
              />
            </div>
          ))}
          {home !== "" && away !== "" && !valid && <p className="text-[10px] text-amber-400">Whole numbers, no draws.</p>}
          {match.played && <p className="text-[10px] text-amber-400">Changing the winner can clear affected later results in this bracket.</p>}
          <div className="flex justify-between gap-3 pt-2">
            <Button size="sm" variant="outline" className="h-12 flex-1 px-2" disabled={update.isPending} onClick={() => setEditing(false)} aria-label="Cancel" data-testid={`button-cancel-breakout-${bracket.id}-${match.id}`}><X className="w-4 h-4 mr-1" />Cancel</Button>
            <Button size="sm" className="h-12 flex-1 px-2 bg-primary text-primary-foreground" disabled={!valid || update.isPending} onClick={submit} aria-label="Save score" data-testid={`button-save-breakout-${bracket.id}-${match.id}`}><Check className="w-4 h-4 mr-1" />Save</Button>
          </div>
        </div>
      ) : (
        <>
          {row(match.homeTeamName, match.homeTeamId, match.homeScore)}
          <div className="h-px bg-border/50" />
          {row(match.awayTeamName, match.awayTeamId, match.awayScore)}
          {canScore && (
            <div className="flex justify-end gap-3 border-t border-border/60 px-2 py-2">
              {match.played && (
                <Button size="sm" variant="ghost" className="h-11 px-3 text-sm text-muted-foreground" disabled={update.isPending} onClick={() => setConfirmAction("clear")} data-testid={`button-clear-breakout-${bracket.id}-${match.id}`}>
                  <Eraser className="w-3 h-3 mr-1" />Clear
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-11 px-3 text-sm text-primary"
                onClick={() => { setHome(match.homeScore?.toString() ?? ""); setAway(match.awayScore?.toString() ?? ""); setEditing(true); }}
                data-testid={`button-edit-breakout-${bracket.id}-${match.id}`}>
                <Edit2 className="w-3 h-3 mr-1" />{match.played ? "Correct" : "Score"}
              </Button>
            </div>
          )}
        </>
      )}
      <Dialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{confirmAction === "clear" ? "Clear this result?" : "Change the winning team?"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This can permanently clear affected later results and the champion of {bracket.name}. The other bracket is not changed.</p>
          <DialogFooter>
            <Button variant="outline" disabled={update.isPending} onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="destructive" disabled={update.isPending} onClick={() => confirmAction === "clear" ? clear() : save()}>
              {update.isPending ? "Saving…" : confirmAction === "clear" ? "Clear result" : "Change winner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BracketBoard({ bracket, groups, organizer, tournamentId, top6 = false }: { bracket: BreakoutBracket; groups: Group[]; organizer: boolean; tournamentId: number; top6?: boolean }) {
  const rounds = useMemo(() => {
    const map = new Map<number, BreakoutMatch[]>();
    const firstRound = bracket.matches.length ? Math.min(...bracket.matches.map((m) => m.round)) : 1;
    bracket.matches
      .filter((m) => !top6 || !isTop6VirtualBye(m, firstRound))
      .forEach((m) => map.set(m.round, [...(map.get(m.round) ?? []), m]));
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([r, ms]) => [r, ms.sort((x, y) => x.matchNumber - y.matchNumber)] as const);
  }, [bracket.matches, top6]);
  const maxRound = rounds.length ? rounds[rounds.length - 1][0] : 1;
  const groupNames = bracket.groupIds.map((id) => groups.find((g) => g.id === id)?.name ?? `Group ${id}`);

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden" aria-label={`${bracket.name} bracket`} data-testid={`section-breakout-${bracket.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-xl font-bold display-font tracking-wide text-foreground truncate">{bracket.name}</h3>
          <p className="text-xs text-muted-foreground truncate">{groupNames.join(" · ") || "No groups assigned"}</p>
          {top6 && <p className="text-[10px] uppercase tracking-widest text-primary mt-0.5" data-testid={`text-breakout-top6-${bracket.id}`}>Top 6 Playoff · seeds 1 and 2 bye to semifinals</p>}
        </div>
        {bracket.winnerTeamName ? (
          <div className="flex items-center gap-2 rounded border border-primary/50 bg-primary/10 px-3 py-1.5" data-testid={`text-breakout-champion-${bracket.id}`}>
            <Trophy className="w-4 h-4 text-primary" />
            <span className="text-[10px] uppercase tracking-widest text-primary/80">Champion</span>
            <span className="font-bold text-primary display-font text-lg leading-none">{bracket.winnerTeamName}</span>
          </div>
        ) : (
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Champion to be decided</span>
        )}
      </div>
      {bracket.matches.length === 0 ? (
        <QualifierList qualifiers={bracket.qualifiers} groups={groups} provisional />
      ) : (
        <div className="overflow-x-auto">
          <div className="flex gap-6 p-4 min-w-max">
            {rounds.map(([round, ms]) => (
              <div key={round} className="flex flex-col">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">{roundLabel(round, maxRound)}</h4>
                <div className="flex flex-1 flex-col justify-around gap-3">
                  {ms.map((m) => <MatchCard key={m.id} match={m} bracket={bracket} organizer={organizer} tournamentId={tournamentId} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function BreakoutKnockoutsPanel({
  tournamentId, groups, teams = [], organizer = false, allGroupMatchesPlayed = false, seedRequest = 0,
}: { tournamentId: number; groups: Group[]; teams?: Team[]; organizer?: boolean; allGroupMatchesPlayed?: boolean; seedRequest?: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: state, isLoading, isError, refetch } = useBreakoutState(tournamentId, true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetAck, setResetAck] = useState(false);
  const [seedOpen, setSeedOpen] = useState(false);
  useEffect(() => { if (seedRequest > 0) setSeedOpen(true); }, [seedRequest]);

  const onState = (data: BreakoutState) => {
    queryClient.setQueryData(getGetBreakoutKnockoutsQueryKey(tournamentId), data);
    queryClient.invalidateQueries({ queryKey: getGetTournamentByIdQueryKey(tournamentId) });
    queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
  };
  const generate = useGenerateBreakoutKnockouts({
    mutation: {
      onSuccess: (d) => { onState(d); setSeedOpen(false); toast({ title: "Breakout brackets generated" }); },
      onError: (err) => toast({ title: "Could not generate", description: errorMessage(err, "Check that the group stage is ready."), variant: "destructive" }),
    },
  });
  const reset = useResetBreakoutKnockouts({
    mutation: {
      onSuccess: (d) => { onState(d); setConfirmReset(false); setResetAck(false); toast({ title: "Breakout brackets reset" }); },
      onError: (err) => toast({ title: "Reset failed", description: errorMessage(err, "Please try again."), variant: "destructive" }),
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading breakout knockouts">
        <Skeleton className="h-8 w-56 bg-card" /><Skeleton className="h-48 bg-card" /><Skeleton className="h-48 bg-card" />
      </div>
    );
  }
  if (isError || !state) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
        <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-destructive" />Breakout knockouts could not be loaded.</span>
        <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-retry-breakout"><RefreshCw className="w-3.5 h-3.5 mr-1" />Retry</Button>
      </div>
    );
  }
  if (!state.enabled) return null;

  const generated = hasGenerated(state);
  const top6 = state.knockoutFormat === "top6";
  const shortBrackets = state.brackets.filter((b) => top6 ? b.qualifiers.length !== 6 : b.qualifiers.length < 2);
  const autoReady = state.qualificationReady && state.brackets.length === 2 && shortBrackets.length === 0;

  return (
    <div className="space-y-4" data-testid="panel-breakout-knockouts">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-2xl font-bold display-font tracking-wide">BREAKOUT KNOCKOUTS</h2>
            <p className="text-xs text-muted-foreground">Two independent {top6 ? "Top 6 Playoff cups" : "brackets"}, two champions.</p>
          </div>
        </div>
        {organizer && (
          generated ? (
            <Button size="sm" variant="outline" className="border-destructive/50 text-destructive hover:bg-destructive/10 text-xs uppercase tracking-wider"
              onClick={() => setConfirmReset(true)} data-testid="button-reset-breakout">
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />Reset both brackets
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="border-primary/50 text-primary text-xs uppercase tracking-wider"
                disabled={generate.isPending} onClick={() => setSeedOpen(true)} data-testid="button-seed-breakout">
                <ListOrdered className="w-3.5 h-3.5 mr-1.5" />Review / seed qualifiers
              </Button>
              <Button size="sm" className="bg-primary text-primary-foreground font-bold uppercase tracking-wider text-xs"
                disabled={generate.isPending || !autoReady}
                title={!autoReady ? (state.qualificationMessage ?? "Qualification is not ready yet") : undefined}
                onClick={() => generate.mutate({ id: tournamentId })} data-testid="button-generate-breakout">
                <Trophy className="w-3.5 h-3.5 mr-1.5" />{generate.isPending ? "Generating…" : "Generate from standings"}
              </Button>
            </div>
          )
        )}
      </div>

      {top6 && <Top6Info label="each cup runs separately" testId="text-breakout-top6-info" />}

      {!generated && (
        <div className="rounded-md border border-dashed border-border bg-card/50 p-5 text-sm text-muted-foreground space-y-1.5" role="status">
          <p>
            {organizer
              ? autoReady
                ? "Qualification is settled. Generate from standings, or review and reseed the qualifiers by hand. The setup locks once generated."
                : allGroupMatchesPlayed
                  ? "Automatic generation is not available yet. You can still seed the qualifiers by hand."
                  : "Qualifiers below are provisional until every group fixture is scored. You can seed the brackets by hand at any time."
              : "Qualifiers below are provisional. The breakout brackets will appear here once the organizer generates them."}
          </p>
          {!state.qualificationReady && state.qualificationMessage && (
            <p className="text-amber-400 flex items-start gap-1.5" data-testid="text-breakout-qualification-message"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{state.qualificationMessage}</p>
          )}
          {shortBrackets.map((b) => (
            <p key={b.id} className="text-amber-400 flex items-start gap-1.5"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{b.name} has {b.qualifiers.length} qualifier{b.qualifiers.length === 1 ? "" : "s"} and needs {top6 ? "exactly 6 for the Top 6 Playoff" : "at least 2"}. Raise qualifiers per group or wildcard places, or change the group assignment.</p>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {state.brackets.map((b) => (
          <BracketBoard key={b.id} bracket={b} groups={groups} organizer={organizer} tournamentId={tournamentId} top6={top6} />
        ))}
      </div>

      {organizer && !generated && (
        <SeedDialog
          open={seedOpen}
          onOpenChange={setSeedOpen}
          brackets={state.brackets}
          groups={groups}
          teams={teams}
          pending={generate.isPending}
          top6={top6}
          onSubmit={(sel) => generate.mutate({ id: tournamentId, data: { brackets: sel } })}
        />
      )}

      <Dialog open={confirmReset} onOpenChange={(o) => { setConfirmReset(o); if (!o) setResetAck(false); }}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="display-font tracking-wide text-xl flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-destructive" />RESET BOTH BRACKETS?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently deletes every match and result in <strong className="text-foreground">both</strong> breakout brackets, including any champions. It cannot be undone. Group-stage results are not affected, and the configuration unlocks for editing.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--destructive))]" checked={resetAck} onChange={(e) => setResetAck(e.target.checked)} data-testid="checkbox-ack-reset-breakout" />
            I understand this is irreversible.
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)} disabled={reset.isPending} data-testid="button-cancel-reset-breakout">Cancel</Button>
            <Button variant="destructive" disabled={!resetAck || reset.isPending} onClick={() => reset.mutate({ id: tournamentId })} data-testid="button-confirm-reset-breakout">
              {reset.isPending ? "Resetting…" : "Reset both"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function QualifierList({ qualifiers, groups, provisional }: { qualifiers: BreakoutQualifier[]; groups: Group[]; provisional?: boolean }) {
  if (qualifiers.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">No qualifiers yet. Standings will fill this in as group results arrive.</p>;
  }
  return (
    <div className="p-4">
      <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">{provisional ? "Provisional seeds" : "Seeds"} · {qualifiers.length} teams</p>
      <ol className="grid gap-1 sm:grid-cols-2">
        {qualifiers.map((q, i) => (
          <li key={q.teamId} className="flex items-center gap-2 rounded border border-border bg-background/40 px-2 py-1.5 text-sm">
            <span className="mono-font text-xs text-primary w-6 text-right">{i + 1}</span>
            <span className="truncate flex-1">{q.teamName}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">{ordinal(q.position + 1)} {groups.find((g) => g.id === q.groupId)?.name ?? ""}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SeedDialog({
  open, onOpenChange, brackets, groups, teams, pending, onSubmit, top6 = false,
}: {
  top6?: boolean;
  open: boolean; onOpenChange: (o: boolean) => void; brackets: BreakoutBracket[]; groups: Group[]; teams: Team[];
  pending: boolean; onSubmit: (sel: { bracketId: number; qualifierTeamIds: number[] }[]) => void;
}) {
  const [picks, setPicks] = useState<Record<number, number[]>>({});
  useEffect(() => {
    if (!open) return;
    const next: Record<number, number[]> = {};
    brackets.forEach((b) => { next[b.id] = b.qualifiers.map((q) => q.teamId); });
    setPicks(next);
    // prefill only when opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const teamName = (id: number) => teams.find((t) => t.id === id)?.name ?? brackets.flatMap((b) => b.qualifiers).find((q) => q.teamId === id)?.teamName ?? `Team ${id}`;
  const groupName = (id: number | null | undefined) => groups.find((g) => g.id === id)?.name ?? "";
  const move = (bid: number, i: number, d: -1 | 1) => setPicks((p) => {
    const l = [...(p[bid] ?? [])]; const j = i + d; if (j < 0 || j >= l.length) return p;
    [l[i], l[j]] = [l[j], l[i]]; return { ...p, [bid]: l };
  });
  const problems = brackets.flatMap((b) => {
    const n = picks[b.id]?.length ?? 0;
    if (top6) return n !== 6 ? [`${b.name} needs exactly 6 teams for the Top 6 Playoff (${n}/6).`] : [];
    return n < 2 ? [`${b.name} needs at least 2 teams.`] : n > 64 ? [`${b.name} can have at most 64 teams.`] : [];
  });
  if (brackets.length !== 2) problems.push("Both brackets must be configured.");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-4xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="display-font tracking-wide text-xl">REVIEW AND SEED QUALIFIERS</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Starts from the current qualifiers. Reorder to set seeds (top is seed 1), remove teams, or add other teams from that bracket's groups. Saving overrides automatic qualification and generates both brackets. {top6 ? "Top 6 Playoff: each bracket needs exactly six ranked teams; seeds 1 and 2 receive semifinal byes automatically." : "Byes are added automatically."}
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {brackets.map((b) => {
            const list = picks[b.id] ?? [];
            const available = teams.filter((t) => t.groupId != null && b.groupIds.includes(t.groupId) && !list.includes(t.id));
            return (
              <div key={b.id} className="rounded-md border border-border bg-background/40 p-3 space-y-2" data-testid={`seed-bracket-${b.id}`}>
                <div className="flex items-center justify-between">
                  <h3 className="display-font text-lg tracking-wide">{b.name}</h3>
                  <span className={`mono-font text-xs ${(top6 ? list.length !== 6 : list.length < 2) ? "text-amber-400" : "text-muted-foreground"}`}>{list.length}{top6 ? "/6" : ""} teams</span>
                </div>
                {list.length === 0 ? (
                  <p className="text-xs text-muted-foreground rounded border border-dashed border-border p-3">No teams selected. Add {top6 ? "exactly 6" : "at least 2"} below.</p>
                ) : (
                  <ol className="space-y-1">
                    {list.map((id, i) => (
                      <li key={id} className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-sm">
                        <span className="mono-font text-xs text-primary w-6 text-right">{i + 1}</span>
                        <span className="flex-1 truncate">{teamName(id)}</span>
                        {top6 && i < 2 && <span className="text-[10px] uppercase tracking-wider text-yellow-400">Bye</span>}
                        <span className="text-[10px] text-muted-foreground truncate max-w-[6rem]">{groupName(teams.find((t) => t.id === id)?.groupId)}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => move(b.id, i, -1)} aria-label={`Move ${teamName(id)} up`}><ArrowUp className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === list.length - 1} onClick={() => move(b.id, i, 1)} aria-label={`Move ${teamName(id)} down`}><ArrowDown className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setPicks((p) => ({ ...p, [b.id]: list.filter((x) => x !== id) }))} aria-label={`Remove ${teamName(id)}`}><X className="w-3.5 h-3.5" /></Button>
                      </li>
                    ))}
                  </ol>
                )}
                {available.length > 0 && (
                  <div className="pt-1">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Add from assigned groups</p>
                    <div className="flex flex-wrap gap-1">
                      {available.map((t) => (
                        <button key={t.id} type="button" disabled={list.length >= (top6 ? 6 : 64)}
                          onClick={() => setPicks((p) => ({ ...p, [b.id]: [...list, t.id] }))}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:border-primary hover:text-primary disabled:opacity-40">
                          <Plus className="w-3 h-3" />{t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {problems.length > 0 && (
          <ul className="text-xs text-amber-400 space-y-0.5" aria-live="polite">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button className="bg-primary text-primary-foreground font-bold uppercase tracking-wider text-xs" disabled={pending || problems.length > 0}
            onClick={() => onSubmit(brackets.map((b) => ({ bracketId: b.id, qualifierTeamIds: picks[b.id] ?? [] })))} data-testid="button-confirm-seed-breakout">
            {pending ? "Generating…" : "Generate with these seeds"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
