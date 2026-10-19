import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetWildcardPlayoffQueryKey,
  useGetWildcardPlayoff,
  useResetWildcardPlayoff,
  useStartWildcardPlayoff,
  useUpdateWildcardPlayoffMatch,
  type WildcardPlayoffMatch,
} from "@workspace/api-client-react";
import { AlertCircle, ArrowRight, Check, Flag, Pencil, RotateCcw, Swords, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export interface WildcardPlayoffPanelProps {
  tournamentId: number;
  organizer: boolean;
  canStart: boolean;
  hasBracket: boolean;
  onManualSelection: () => void;
  onUseResult?: () => void;
  selectedTeamIds?: readonly number[];
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const data = "data" in error ? error.data : undefined;
    if (data && typeof data === "object") {
      const detail = "detail" in data ? data.detail : undefined;
      const message = "message" in data ? data.message : undefined;
      const apiError = "error" in data ? data.error : undefined;
      if (typeof detail === "string") return detail;
      if (typeof message === "string") return message;
      if (typeof apiError === "string") return apiError;
    }
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return "Something went wrong. Please try again.";
}

const scoreIsValid = (value: string) => /^(0|[1-9]\d*)$/.test(value.trim()) && Number.isSafeInteger(Number(value.trim()));

export function WildcardPlayoffPanel({
  tournamentId,
  organizer,
  canStart,
  hasBracket,
  onManualSelection,
  onUseResult,
  selectedTeamIds,
}: WildcardPlayoffPanelProps) {
  const queryClient = useQueryClient();
  const queryKey = getGetWildcardPlayoffQueryKey(tournamentId);
  const { data: playoff, isLoading, isError, error: loadError, refetch, isFetching } = useGetWildcardPlayoff(tournamentId, {
    query: { queryKey, refetchInterval: 15000 },
  });
  const [editing, setEditing] = useState<number | null>(null);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [validationError, setValidationError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const start = useStartWildcardPlayoff({
    mutation: {
      onSuccess: () => { setActionMessage("Wildcard playoff started. All three fixtures are ready."); void refresh(); },
      onError: (e) => setActionError(errorMessage(e)),
    },
  });
  const update = useUpdateWildcardPlayoffMatch({
    mutation: {
      onSuccess: () => {
        setEditing(null);
        setValidationError("");
        setActionMessage("Score saved. The table has been updated.");
        void refresh();
      },
      onError: (e) => setActionError(errorMessage(e)),
    },
  });
  const reset = useResetWildcardPlayoff({
    mutation: {
      onSuccess: () => {
        setConfirmReset(false);
        setEditing(null);
        setActionMessage("Wildcard playoff reset. Scores and fixtures were removed.");
        void refresh();
      },
      onError: (e) => setActionError(errorMessage(e)),
    },
  });

  const busy = start.isPending || update.isPending || reset.isPending;
  const matches = [...(playoff?.matches ?? [])].sort((a, b) => a.gameNumber - b.gameNumber);
  const standings = playoff?.standings ?? [];
  const playedCount = matches.filter((match) => match.played).length;
  const playoffResultIds = playoff?.qualifiedTeamIds?.length === 2 && !playoff.tieAtCutoff ? playoff.qualifiedTeamIds : null;
  const qualifiedIds = hasBracket
    ? (selectedTeamIds?.length === 2 ? [...selectedTeamIds] : null)
    : playoffResultIds;
  const organizerOverride = hasBracket && qualifiedIds !== null &&
    (!playoffResultIds || qualifiedIds.some((id) => !playoffResultIds.includes(id)));
  const qualifiedNames = qualifiedIds?.map((id) => standings.find((row) => row.teamId === id)?.teamName).filter((name): name is string => !!name) ?? [];
  const canEdit = organizer && !hasBracket;

  const beginEdit = (match: WildcardPlayoffMatch) => {
    setEditing(match.id);
    setHomeScore(match.homeScore === null ? "" : String(match.homeScore));
    setAwayScore(match.awayScore === null ? "" : String(match.awayScore));
    setValidationError("");
    setActionError("");
    setActionMessage("");
  };

  const saveScore = (event: FormEvent<HTMLFormElement>, matchId: number) => {
    event.preventDefault();
    if (!scoreIsValid(homeScore) || !scoreIsValid(awayScore)) {
      setValidationError("Enter a whole-number score of 0 or more for both teams.");
      return;
    }
    if (Number(homeScore) === Number(awayScore)) {
      setValidationError("A playoff game must have a winner. Enter different scores.");
      return;
    }
    setValidationError("");
    setActionError("");
    setActionMessage("");
    update.mutate({ id: tournamentId, matchId, data: { homeScore: Number(homeScore), awayScore: Number(awayScore) } });
  };

  return (
    <Card className="overflow-hidden border-border bg-card text-card-foreground" data-testid="card-wildcard-playoff">
      <CardContent className="p-0">
        <div className="border-b border-border bg-muted/30 px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
                <Swords className="h-4 w-4" aria-hidden="true" /> Qualification stage / optional
              </div>
              <h3 className="display-font text-3xl font-bold uppercase leading-none tracking-wide sm:text-4xl">Third-place wildcard playoff</h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Three third-place teams play each other once. A win earns 3 points; the top two take the final knockout places.
                This is <strong className="font-medium text-foreground">not</strong> the bronze-medal match played after the semifinals.
              </p>
            </div>
            <div className="shrink-0 self-start rounded border border-primary/30 bg-primary/10 px-3 py-2 text-left sm:text-right">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-primary">Playoff fixtures</span>
              <span className="mono-font text-lg font-bold text-foreground" data-testid="text-wildcard-progress">{matches.length ? `${playedCount} / ${matches.length}` : "Not started"}</span>
            </div>
          </div>
          {matches.length > 0 && <div className="mt-5 flex gap-1" aria-label={`${playedCount} of ${matches.length} wildcard fixtures played`}>
            {matches.map((match) => <span key={match.id} className={`h-1 flex-1 rounded-full ${match.played ? "bg-primary" : "bg-border"}`} />)}
          </div>}
        </div>

        {isLoading && !playoff ? (
          <div className="space-y-3 p-4 sm:p-6" aria-label="Loading wildcard playoff">
            <Skeleton className="h-16 w-full bg-muted" /><Skeleton className="h-16 w-full bg-muted" /><Skeleton className="h-16 w-full bg-muted" />
          </div>
        ) : isError && !playoff ? (
          <div className="flex flex-col items-start gap-3 p-5 sm:p-6" role="alert">
            <p className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" aria-hidden="true" />{errorMessage(loadError)}</p>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching} data-testid="button-retry-wildcard">Retry loading</Button>
          </div>
        ) : (
          <>
            {isError && playoff && <div className="mx-4 mt-4 flex flex-wrap items-center gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive sm:mx-6" role="alert" data-testid="status-wildcard-refresh-error"><AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />Could not refresh: {errorMessage(loadError)} <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} data-testid="button-retry-wildcard-refresh">Retry</Button></div>}
            {actionError && <div className="mx-4 mt-4 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive sm:mx-6" role="alert" data-testid="status-wildcard-error"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{actionError}</div>}
            {actionMessage && <p className="mx-4 mt-4 flex items-center gap-2 text-sm text-primary sm:mx-6" role="status" data-testid="status-wildcard-action"><Check className="h-4 w-4" aria-hidden="true" />{actionMessage}</p>}

            {matches.length === 0 ? (
              <div className="mx-4 my-5 flex flex-col gap-4 rounded border border-dashed border-border bg-background/30 p-5 sm:mx-6 sm:p-6" data-testid="status-wildcard-pending">
                <div className="flex items-start gap-3"><Flag className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><div><p className="font-semibold">{hasBracket ? "Knockout teams chosen manually" : "The playoff has not started"}</p><p className="mt-1 text-sm text-muted-foreground">{hasBracket ? "No wildcard playoff games were played. See the knockout bracket for the selected teams." : "Fixtures and standings will appear here once an organizer starts the round robin."}</p></div></div>
                {organizer && <div className="flex flex-wrap gap-2 pl-0 sm:pl-8">
                  <Button onClick={() => { setActionError(""); setActionMessage(""); start.mutate({ id: tournamentId }); }} disabled={!canStart || hasBracket || busy} data-testid="button-start-wildcard">Start wildcard playoff</Button>
                  {!canStart && !hasBracket && <span className="self-center text-xs text-muted-foreground">Finish all group games before starting.</span>}
                  {hasBracket && <span className="self-center text-xs text-muted-foreground">A knockout bracket already exists.</span>}
                </div>}
              </div>
            ) : (
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
                <section className="min-w-0 border-b border-border px-4 py-5 sm:px-6 lg:border-b-0 lg:border-r" aria-labelledby="wildcard-fixtures-heading">
                  <div className="mb-4 flex items-baseline justify-between gap-2">
                    <h4 id="wildcard-fixtures-heading" className="display-font text-2xl font-semibold uppercase tracking-wide">Three games. Two places.</h4>
                    <span className="mono-font shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">Round robin</span>
                  </div>
                  <div className="space-y-2">
                    {matches.map((match) => (
                      <div key={match.id} className={`rounded border p-3 sm:p-4 ${match.played ? "border-primary/25 bg-primary/[0.035]" : "border-border bg-background/30"}`} data-testid={`card-wildcard-match-${match.id}`}>
                        <div className="mb-3 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                          <span>Game {String(match.gameNumber).padStart(2, "0")}</span><span data-testid={`status-wildcard-match-${match.id}`} className={match.played ? "text-primary" : ""}>{match.played ? "Final" : "Awaiting score"}</span>
                        </div>
                        {editing === match.id && canEdit ? (
                          <form onSubmit={(event) => saveScore(event, match.id)} className="space-y-3" data-testid={`form-wildcard-score-${match.id}`}>
                            <div className="grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-2">
                              <label htmlFor={`wildcard-home-${match.id}`} className="min-w-0 truncate text-sm font-semibold">{match.homeTeamName}</label>
                              <Input id={`wildcard-home-${match.id}`} type="number" min="0" step="1" inputMode="numeric" value={homeScore} onChange={(e) => setHomeScore(e.target.value)} aria-label={`${match.homeTeamName} score, game ${match.gameNumber}`} className="h-10 text-center mono-font" data-testid={`input-wildcard-home-${match.id}`} />
                              <label htmlFor={`wildcard-away-${match.id}`} className="min-w-0 truncate text-sm font-semibold">{match.awayTeamName}</label>
                              <Input id={`wildcard-away-${match.id}`} type="number" min="0" step="1" inputMode="numeric" value={awayScore} onChange={(e) => setAwayScore(e.target.value)} aria-label={`${match.awayTeamName} score, game ${match.gameNumber}`} className="h-10 text-center mono-font" data-testid={`input-wildcard-away-${match.id}`} />
                            </div>
                            {validationError && <p className="text-xs text-destructive" role="alert">{validationError}</p>}
                            <div className="flex flex-wrap gap-2">
                              <Button type="submit" size="sm" disabled={busy} data-testid={`button-save-wildcard-score-${match.id}`}><Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{update.isPending ? "Saving…" : "Save score"}</Button>
                              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(null); setValidationError(""); }} data-testid={`button-cancel-wildcard-score-${match.id}`}><X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Cancel</Button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-sm font-semibold" data-testid={`text-wildcard-home-${match.id}`}>{match.homeTeamName}</span><span className="mono-font shrink-0 text-lg font-bold" data-testid={`text-wildcard-home-score-${match.id}`}>{match.homeScore ?? "–"}</span></div>
                              <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-sm font-semibold" data-testid={`text-wildcard-away-${match.id}`}>{match.awayTeamName}</span><span className="mono-font shrink-0 text-lg font-bold" data-testid={`text-wildcard-away-score-${match.id}`}>{match.awayScore ?? "–"}</span></div>
                            </div>
                            {canEdit && <Button variant="outline" size="sm" disabled={busy} onClick={() => beginEdit(match)} aria-label={`${match.played ? "Edit" : "Enter"} score for game ${match.gameNumber}: ${match.homeTeamName} against ${match.awayTeamName}`} data-testid={`button-edit-wildcard-score-${match.id}`} className="shrink-0"><Pencil className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" /><span className="sr-only sm:not-sr-only">{match.played ? "Edit" : "Score"}</span></Button>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="min-w-0 px-4 py-5 sm:px-6" aria-labelledby="wildcard-table-heading">
                  <div className="mb-4">
                    <h4 id="wildcard-table-heading" className="display-font text-2xl font-semibold uppercase tracking-wide">Qualification table</h4>
                    <p className="text-xs text-muted-foreground">3 points for a win · Top 2 qualify when resolved</p>
                  </div>
                  <div className="overflow-x-auto rounded border border-border">
                    <table className="w-full min-w-[365px] text-sm">
                      <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground"><tr>
                        <th scope="col" className="py-2.5 pl-3 pr-1 text-left">#</th><th scope="col" className="px-1 py-2.5 text-left">Team</th>
                        <th scope="col" className="px-1.5 py-2.5 text-center" title="Played">P</th><th scope="col" className="px-1.5 py-2.5 text-center" title="Wins">W</th>
                        <th scope="col" className="px-1.5 py-2.5 text-center" title="Goal difference">GD</th><th scope="col" className="py-2.5 pl-1.5 pr-3 text-right" title="Points">Pts</th>
                      </tr></thead>
                      <tbody>{standings.map((row, index) => {
                        const qualified = !!qualifiedIds?.includes(row.teamId);
                        return <tr key={row.teamId} className={`border-t border-border/60 ${qualified ? "bg-primary/10" : ""}`} data-testid={`row-wildcard-standing-${row.teamId}`}>
                          <td className={`py-3 pl-3 pr-1 mono-font text-xs ${qualified ? "text-primary" : "text-muted-foreground"}`}>{String(index + 1).padStart(2, "0")}</td>
                          <td className="max-w-[130px] truncate px-1 py-3 font-medium" title={row.teamName}>{row.teamName}{qualified && <span className="sr-only">, qualified</span>}</td>
                          <td className="px-1.5 py-3 text-center mono-font text-muted-foreground">{row.played}</td><td className="px-1.5 py-3 text-center mono-font">{row.wins}</td>
                          <td className="px-1.5 py-3 text-center mono-font">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                          <td className={`py-3 pl-1.5 pr-3 text-right mono-font font-bold ${qualified ? "text-primary" : ""}`}>{row.points}</td>
                        </tr>;
                      })}</tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">GD = goals scored minus goals conceded. Full scores: {standings.map((row) => `${row.teamName} ${row.goalsFor}–${row.goalsAgainst}`).join(" · ")}.</p>
                  <div className={`mt-5 rounded border p-3.5 ${playoff?.tieAtCutoff ? "border-amber-500/40 bg-amber-500/10" : qualifiedIds ? "border-primary/40 bg-primary/10" : "border-border bg-muted/20"}`} role="status" data-testid="status-wildcard-qualification">
                    <div className="flex items-start gap-2.5">
                      {playoff?.tieAtCutoff ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" /> : qualifiedIds ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <Flag className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                       <div><p className="text-sm font-semibold">{organizerOverride ? "Knockout teams chosen by organizer" : playoff?.tieAtCutoff && !hasBracket ? "Tie at the qualification cutoff" : qualifiedIds ? "Two teams through" : hasBracket ? "See the knockout bracket" : "Places still open"}</p>
                         <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{organizerOverride ? `${qualifiedNames.length === 2 ? qualifiedNames.join(" and ") : "The selected teams"} were manually selected for the knockout.` : hasBracket && !qualifiedIds ? "The playoff table alone does not show who was chosen. See the knockout bracket." : playoff?.tieAtCutoff ? "The final places cannot be resolved from the playoff table. An organizer must choose the knockout teams manually." : qualifiedIds ? `${qualifiedNames.length === 2 ? qualifiedNames.join(" and ") : "The top two teams"} take the last two knockout places.` : "Finish all three games to resolve the final two knockout places."}</p>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {organizer && <div className="flex flex-col gap-3 border-t border-border bg-muted/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button variant="outline" onClick={onManualSelection} disabled={hasBracket || busy} data-testid="button-manual-wildcard-selection">Choose knockout teams manually <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Button>
                {onUseResult && <Button onClick={onUseResult} disabled={!qualifiedIds || hasBracket || busy} data-testid="button-use-wildcard-result">Use playoff result <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Button>}
              </div>
              {matches.length > 0 && <Button variant="ghost" className="self-start text-muted-foreground hover:text-destructive" onClick={() => setConfirmReset(true)} disabled={hasBracket || busy} data-testid="button-reset-wildcard"><RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />Reset playoff</Button>}
              {hasBracket && <p className="text-xs text-muted-foreground">Locked after knockout bracket creation.</p>}
            </div>}
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset wildcard playoff?</AlertDialogTitle>
            <AlertDialogDescription>This removes all three fixtures and their scores. You can start the playoff again before a knockout bracket is created. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          {actionError && <p className="flex items-start gap-2 text-sm text-destructive" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{actionError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reset.isPending} data-testid="button-cancel-reset-wildcard">Keep playoff</AlertDialogCancel>
            <AlertDialogAction disabled={reset.isPending || hasBracket} onClick={(event) => { event.preventDefault(); setActionError(""); setActionMessage(""); reset.mutate({ id: tournamentId }); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-reset-wildcard">{reset.isPending ? "Resetting…" : "Reset playoff"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default WildcardPlayoffPanel;