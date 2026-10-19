import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTeamEventState,
  useSaveTeamEventRubberLineup,
  useScoreTeamEventRubber,
  useResetTeamEventRubberScore,
  useSaveTeamEventDreambreakerLineup,
  useScoreTeamEventDreambreaker,
  getGetTeamEventStateQueryKey,
  getListTournamentMatchesQueryKey,
  getListKnockoutMatchesQueryKey,
  getListTournamentStandingsQueryKey,
  type TeamEventRubber,
  type TeamEventPlayer,
  type TeamEventDreambreaker,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Check, RotateCcw, X } from "lucide-react";

type Props = {
  tournamentId: number;
  matchId: number | null;
  isKnockout: boolean;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  onClose: () => void;
};

function prepareGamesForSave(
  games: { homeScore: string; awayScore: string }[],
  bestOf: number,
): { games?: { homeScore: number; awayScore: number }[]; error?: string } {
  const entered = games.filter((game) => game.homeScore !== "" || game.awayScore !== "");
  if (entered.some((game) => game.homeScore === "" || game.awayScore === "")) {
    return { error: "Enter both team scores for every game used." };
  }

  const parsed = entered.map((game) => ({
    homeScore: Number(game.homeScore),
    awayScore: Number(game.awayScore),
  }));
  const invalidGame = parsed.find(({ homeScore, awayScore }) =>
    !Number.isInteger(homeScore)
    || !Number.isInteger(awayScore)
    || homeScore < 0
    || awayScore < 0
    || homeScore === awayScore
  );
  if (invalidGame) {
    return { error: "Each game needs non-negative whole-number scores and cannot end tied." };
  }

  if (bestOf === 1) {
    return parsed.length === 1
      ? { games: parsed }
      : { error: "Enter one completed game score." };
  }
  if (parsed.length < 2) {
    return { error: "Enter the first two completed game scores." };
  }

  const firstWinner = parsed[0].homeScore > parsed[0].awayScore ? "home" : "away";
  const secondWinner = parsed[1].homeScore > parsed[1].awayScore ? "home" : "away";
  if (firstWinner === secondWinner) return { games: parsed.slice(0, 2) };
  return parsed.length >= 3
    ? { games: parsed.slice(0, 3) }
    : { error: "The teams split the first two games, so a third game score is required." };
}

export function TeamEventTieDialog({
  tournamentId, matchId, isKnockout, homeTeamId, awayTeamId, homeTeamName, awayTeamName, onClose
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: teamEventState } = useGetTeamEventState(tournamentId, {
    query: {
      queryKey: getGetTeamEventStateQueryKey(tournamentId),
      enabled: !!matchId,
    }
  });

  const saveLineup = useSaveTeamEventRubberLineup({
    mutation: {
      onSuccess: (updatedRubber) => {
        setLineupDrafts((current) => {
          const next = { ...current };
          delete next[updatedRubber.id];
          return next;
        });
        queryClient.invalidateQueries({ queryKey: getGetTeamEventStateQueryKey(tournamentId) });
        toast({ title: "Lineup saved" });
      },
      onError: (e: any) => toast({ title: "Error", description: e?.response?.data?.error || "Failed to save lineup", variant: "destructive" }),
    }
  });

  const scoreRubber = useScoreTeamEventRubber({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTeamEventStateQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentStandingsQueryKey(tournamentId) });
        setEditingScoreId(null);
        toast({ title: "Score saved" });
      },
      onError: (e: any) => toast({ title: "Error", description: e?.response?.data?.error || "Failed to save score", variant: "destructive" }),
    }
  });
  const resetRubberScore = useResetTeamEventRubberScore({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTeamEventStateQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentStandingsQueryKey(tournamentId) });
        setEditingScoreId(null);
        toast({ title: "Score cleared", description: "This rubber is now marked as not played." });
      },
      onError: (e: any) => toast({ title: "Error", description: e?.response?.data?.error || "Failed to clear score", variant: "destructive" }),
    }
  });

  const [editingScoreId, setEditingScoreId] = useState<number | null>(null);
  const [scoreForm, setScoreForm] = useState<{games: {homeScore: string, awayScore: string}[]}>({ games: [] });
  const [lineupDrafts, setLineupDrafts] = useState<Record<number, { home: number[], away: number[] }>>({});

  const rubbers = useMemo(() => {
    if (!teamEventState || !matchId) return [];
    return teamEventState.rubbers
      .filter(r => isKnockout ? r.knockoutMatchId === matchId : r.groupMatchId === matchId)
      .sort((a, b) => a.order - b.order);
  }, [teamEventState, matchId, isKnockout]);

  const homeRoster = homeTeamId ? teamEventState?.rosters[homeTeamId] ?? [] : [];
  const awayRoster = awayTeamId ? teamEventState?.rosters[awayTeamId] ?? [] : [];

  if (!matchId) return null;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-5xl bg-card border-border max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="display-font tracking-wide text-primary text-2xl uppercase">
            TIE: {homeTeamName} vs {awayTeamName}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-2 divide-y divide-border">
          {rubbers.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-4">No rubbers found for this tie.</p>
          )}

          {rubbers.map(rubber => {
            const isEditing = editingScoreId === rubber.id;
            const lineupDraft = lineupDrafts[rubber.id] ?? {
              home: rubber.homePlayerIds,
              away: rubber.awayPlayerIds,
            };
            const lineupChanged =
              JSON.stringify(lineupDraft.home) !== JSON.stringify(rubber.homePlayerIds)
              || JSON.stringify(lineupDraft.away) !== JSON.stringify(rubber.awayPlayerIds);

            return (
              <section key={rubber.id} className="py-5 first:pt-2">
                <div className="px-1 pb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-primary font-bold display-font text-lg">Rubber {rubber.order}</span>
                    <Badge variant="outline" className="border-primary/30 uppercase tracking-wider text-[10px]">{rubber.matchType.replace("_", " ")}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground uppercase tracking-widest">
                    Best of {rubber.bestOf} • Suggested target {rubber.targetPoints}
                  </div>
                </div>

                <div className="px-1 grid grid-cols-1 md:grid-cols-[1fr_180px_1fr] gap-4 items-start">
                  {/* Home Lineup */}
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 text-center md:text-left">{homeTeamName}</div>
                    <LineupSelect
                      roster={homeRoster}
                      selectedIds={lineupDraft.home}
                      matchType={rubber.matchType}
                      onChange={(ids) => setLineupDrafts((current) => ({
                        ...current,
                        [rubber.id]: { home: ids, away: lineupDraft.away },
                      }))}
                      disabled={saveLineup.isPending}
                    />
                  </div>

                  
                  {/* Score */}
                  <div className="flex flex-col items-center justify-center px-4">
                    {
                      <Button
                        size="sm"
                        variant={lineupChanged ? "default" : "outline"}
                        className="mb-3 w-full whitespace-nowrap"
                        disabled={!lineupChanged || saveLineup.isPending}
                        onClick={() => saveLineup.mutate({
                          id: rubber.id,
                          data: {
                            homePlayerIds: lineupDraft.home,
                            awayPlayerIds: lineupDraft.away,
                          },
                        })}
                      >
                        {saveLineup.isPending ? "Saving…" : lineupChanged ? "Save Lineup" : "Lineup Saved"}
                      </Button>
                    }
                    {isEditing ? (
                      <div className="flex flex-col gap-3 w-full">
                        <div className="flex flex-col gap-2 w-full items-center">
                          {scoreForm.games.map((g, gIdx) => (
                            <div key={gIdx} className="flex gap-2 items-center">
                              <span className="text-[10px] text-muted-foreground w-4">G{gIdx+1}</span>
                              <Input
                                type="number" className="w-12 h-10 text-center text-sm font-bold bg-background border-border p-1"
                                value={g.homeScore} onChange={e => {
                                  const newG = [...scoreForm.games];
                                  newG[gIdx].homeScore = e.target.value;
                                  setScoreForm({ games: newG });
                                }}
                                autoFocus={gIdx === 0}
                              />
                              <span className="flex items-center text-muted-foreground">-</span>
                              <Input
                                type="number" className="w-12 h-10 text-center text-sm font-bold bg-background border-border p-1"
                                value={g.awayScore} onChange={e => {
                                  const newG = [...scoreForm.games];
                                  newG[gIdx].awayScore = e.target.value;
                                  setScoreForm({ games: newG });
                                }}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-1 justify-center">
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-green-400" onClick={() => {
                            const result = prepareGamesForSave(scoreForm.games, rubber.bestOf);
                            if (!result.games) {
                              toast({
                                title: "Score not saved",
                                description: result.error,
                                variant: "destructive",
                              });
                              return;
                            }
                            scoreRubber.mutate({ id: rubber.id, data: { games: result.games } });
                          }}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingScoreId(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {(rubber.games?.length ?? 0) > 0 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={resetRubberScore.isPending}
                            onClick={() => {
                              if (window.confirm("Clear this rubber score and mark it as not played? The saved lineup will be kept.")) {
                                resetRubberScore.mutate({ id: rubber.id });
                              }
                            }}
                          >
                            <RotateCcw className="mr-1.5 h-3 w-3" />
                            {resetRubberScore.isPending ? "Clearing…" : "Clear score"}
                          </Button>
                        )}
                        {rubber.bestOf === 3 && (
                          <p className="max-w-48 text-center text-[10px] leading-snug text-muted-foreground">
                            Game 3 is only required when the first two games are split.
                          </p>
                        )}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-auto min-h-16 w-full flex-col gap-1 border-primary/30 py-2"
                        disabled={saveLineup.isPending || lineupChanged}
                        onClick={() => {
                          const existing = rubber.games?.length ? rubber.games : [];
                          const initialGames = Array.from({ length: rubber.bestOf }).map((_, i) => ({
                            homeScore: existing[i]?.homeScore !== undefined ? String(existing[i].homeScore) : "",
                            awayScore: existing[i]?.awayScore !== undefined ? String(existing[i].awayScore) : ""
                          }));
                          setScoreForm({ games: initialGames });
                          setEditingScoreId(rubber.id);
                        }}
                      >
                        {rubber.games && rubber.games.length > 0 ? (
                          <div className="flex flex-col gap-1 items-center">
                            {rubber.games.map((g, i) => (
                              <div key={i} className="text-sm font-bold mono-font tracking-widest text-foreground group-hover:text-primary transition-colors">
                                {g.homeScore}&nbsp;:&nbsp;{g.awayScore}
                              </div>
                            ))}
                            <div className="text-xs font-bold text-primary mt-1 border-t border-primary/20 pt-1 w-full text-center">
                              {rubber.homeScore} - {rubber.awayScore}
                            </div>
                          </div>
                        ) : (
                            <div className="text-xl font-bold mono-font tracking-widest text-muted-foreground">
                            - : -
                          </div>
                        )}
                        <div className="text-[10px] text-primary uppercase tracking-widest">
                          {rubber.games?.length ? "Edit score" : "Enter score"}
                        </div>
                      </Button>
                    )}
                  </div>


                  {/* Away Lineup */}
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 text-center md:text-right">{awayTeamName}</div>
                    <LineupSelect
                      roster={awayRoster}
                      selectedIds={lineupDraft.away}
                      matchType={rubber.matchType}
                      onChange={(ids) => setLineupDrafts((current) => ({
                        ...current,
                        [rubber.id]: { home: lineupDraft.home, away: ids },
                      }))}
                      disabled={saveLineup.isPending}
                      alignRight
                    />
                  </div>
                </div>
              </section>
            );
          })}
          {isKnockout && teamEventState?.config?.dreambreakerEnabled && (() => {
            const dreambreaker = teamEventState.dreambreakers.find((item) => item.knockoutMatchId === matchId);
            return dreambreaker ? (
              <DreambreakerEditor
                dreambreaker={dreambreaker}
                tournamentId={tournamentId}
                homeTeamId={homeTeamId}
                awayTeamId={awayTeamId}
                homeTeamName={homeTeamName}
                awayTeamName={awayTeamName}
                homeRoster={homeRoster}
                awayRoster={awayRoster}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Dreambreaker becomes available only if all regulation rubbers finish tied.
              </div>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DreambreakerEditor({ dreambreaker, tournamentId, homeTeamId, awayTeamId, homeTeamName, awayTeamName, homeRoster, awayRoster }: {
  dreambreaker: TeamEventDreambreaker;
  tournamentId: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeRoster: TeamEventPlayer[];
  awayRoster: TeamEventPlayer[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [homeRotation, setHomeRotation] = useState<number[]>(dreambreaker.homePlayerIds);
  const [awayRotation, setAwayRotation] = useState<number[]>(dreambreaker.awayPlayerIds);
  const [homeScore, setHomeScore] = useState(dreambreaker.homeScore?.toString() ?? "");
  const [awayScore, setAwayScore] = useState(dreambreaker.awayScore?.toString() ?? "");
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetTeamEventStateQueryKey(tournamentId) });
  const saveRotation = useSaveTeamEventDreambreakerLineup({
    mutation: {
      onSuccess: () => { refresh(); toast({ title: "Dreambreaker rotation saved" }); },
      onError: (error: any) => toast({ title: "Error", description: error?.response?.data?.error || error?.message, variant: "destructive" }),
    },
  });
  const scoreDreambreaker = useScoreTeamEventDreambreaker({
    mutation: {
      onSuccess: () => {
        refresh();
        queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
        toast({ title: "Dreambreaker score updated" });
      },
      onError: (error: any) => toast({ title: "Error", description: error?.response?.data?.error || error?.message, variant: "destructive" }),
    },
  });
  const firstSubmitted = dreambreaker.firstTeamId != null;
  const firstRotation = dreambreaker.firstTeamId === homeTeamId ? dreambreaker.homePlayerIds : dreambreaker.awayPlayerIds;
  const counterTeamId = dreambreaker.firstTeamId === homeTeamId ? awayTeamId : homeTeamId;
  const activeRotationIndex = Math.floor(((Number(homeScore) || 0) + (Number(awayScore) || 0)) / 4) % 4;
  const activeHomePlayer = homeRoster.find((player) => player.id === homeRotation[activeRotationIndex]);
  const activeAwayPlayer = awayRoster.find((player) => player.id === awayRotation[activeRotationIndex]);

  const rotationEditor = (teamId: number | null, name: string | null, roster: TeamEventPlayer[], values: number[], setValues: (ids: number[]) => void) => {
    const isCounter = firstSubmitted && counterTeamId === teamId;
    const canSubmit = !firstSubmitted || dreambreaker.firstTeamId === teamId || (isCounter && firstRotation.length === 4);
    return (
      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {name} {dreambreaker.firstTeamId === teamId ? "· submits first" : isCounter ? "· counter-lineup" : ""}
        </div>
        {[0, 1, 2, 3].map((index) => (
          <select
            key={index}
            value={values[index] ?? ""}
            onChange={(event) => {
              const next = [...values];
              next[index] = Number(event.target.value);
              setValues(next);
            }}
            disabled={saveRotation.isPending}
            className="w-full rounded-md border border-border bg-background p-2 text-sm"
          >
            <option value="">Rotation {index + 1}</option>
            {roster.map((player) => <option key={player.id} value={player.id}>{player.name} ({player.gender === "male" ? "M" : "F"})</option>)}
          </select>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={!teamId || !canSubmit || values.length !== 4 || new Set(values).size !== 4 || saveRotation.isPending}
          onClick={() => teamId && saveRotation.mutate({ id: dreambreaker.knockoutMatchId, data: { teamId, playerIds: values } })}
        >
          Save {firstSubmitted ? "Rotation" : "as First Rotation"}
        </Button>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-4" data-testid="dreambreaker-editor">
      <div>
        <h3 className="font-bold text-primary">Dreambreaker</h3>
        <p className="text-xs text-muted-foreground">Four named players per team: two men and two women. Singles rotate in this order every four rallies. First rotation is visible before the counter-lineup is submitted.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {rotationEditor(homeTeamId, homeTeamName, homeRoster, homeRotation, setHomeRotation)}
        {rotationEditor(awayTeamId, awayTeamName, awayRoster, awayRotation, setAwayRotation)}
      </div>
      <div className="flex flex-wrap items-end justify-center gap-2 border-t border-primary/20 pt-4">
        {homeRotation.length === 4 && awayRotation.length === 4 && (
          <div className="w-full rounded-md bg-background/60 p-2 text-center text-xs text-muted-foreground">
            Current four-rally block: <span className="font-semibold text-foreground">{activeHomePlayer?.name ?? "TBD"} vs {activeAwayPlayer?.name ?? "TBD"}</span>
          </div>
        )}
        <label className="text-xs text-muted-foreground">Home score<Input type="number" min={0} value={homeScore} onChange={(event) => setHomeScore(event.target.value)} className="mt-1 w-20 text-center" /></label>
        <span className="pb-2 text-muted-foreground">–</span>
        <label className="text-xs text-muted-foreground">Away score<Input type="number" min={0} value={awayScore} onChange={(event) => setAwayScore(event.target.value)} className="mt-1 w-20 text-center" /></label>
        <Button
          disabled={dreambreaker.homePlayerIds.length !== 4 || dreambreaker.awayPlayerIds.length !== 4 || homeScore === "" || awayScore === "" || scoreDreambreaker.isPending}
          onClick={() => scoreDreambreaker.mutate({ id: dreambreaker.knockoutMatchId, data: { homeScore: Number(homeScore), awayScore: Number(awayScore) } })}
        >
          Save Score
        </Button>
      </div>
    </div>
  );
}

function LineupSelect({ roster, selectedIds, matchType, onChange, disabled, alignRight }: {
  roster: TeamEventPlayer[];
  selectedIds: number[];
  matchType: TeamEventRubber["matchType"];
  onChange: (ids: number[]) => void;
  disabled: boolean;
  alignRight?: boolean;
}) {
  const isDoubles = matchType.includes("doubles");
  const slotGenders: TeamEventPlayer["gender"][] = matchType === "mixed_doubles"
    ? ["male", "female"]
    : Array(isDoubles ? 2 : 1).fill(matchType.startsWith("mens_") ? "male" : "female");

  const handleChange = (index: number, val: string) => {
    const arr = [...selectedIds];
    if (val) arr[index] = Number(val);
    else arr[index] = undefined as unknown as number;
    onChange(arr.filter((id) => id !== undefined));
  };

  return (
    <div className={`flex flex-col gap-2 ${alignRight ? "items-end" : "items-start"}`}>
      {slotGenders.map((gender, index) => (
        <select
          key={index}
          className="bg-background border border-border rounded text-sm p-2 w-full max-w-[200px]"
          value={selectedIds[index] ?? ""}
          onChange={(e) => handleChange(index, e.target.value)}
          disabled={disabled}
        >
          <option value="">-- Select {gender === "male" ? "Male" : "Female"} Player --</option>
          {roster
            .filter((player) => player.gender === gender)
            .filter((player) => selectedIds[index] === player.id || !selectedIds.includes(player.id))
            .map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
        </select>
      ))}
    </div>
  );
}
