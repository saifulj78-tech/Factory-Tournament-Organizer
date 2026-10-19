import { useMemo } from "react";
import {
  type TeamEventState,
  type TeamEventPlayer,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type Props = {
  teamEventState: TeamEventState;
  matchId: number | null;
  isKnockout: boolean;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  onClose: () => void;
};

export function SpectatorTieDialog({
  teamEventState, matchId, isKnockout, homeTeamId, awayTeamId, homeTeamName, awayTeamName, onClose
}: Props) {
  const rubbers = useMemo(() => {
    if (!teamEventState || !matchId) return [];
    return teamEventState.rubbers
      .filter(r => isKnockout ? r.knockoutMatchId === matchId : r.groupMatchId === matchId)
      .sort((a, b) => a.order - b.order);
  }, [teamEventState, matchId, isKnockout]);

  const allPlayers = useMemo(
    () => Object.values(teamEventState.rosters).flat(),
    [teamEventState.rosters],
  );
  const playerById = useMemo(
    () => new Map(allPlayers.map((player) => [player.id, player])),
    [allPlayers],
  );

  const getPlayerName = (id: number | undefined) => {
    if (id === undefined) return "Lineup not selected";
    return playerById.get(id)?.name ?? `Player #${id}`;
  };

  if (!matchId) return null;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="display-font tracking-wide text-primary text-xl uppercase text-center border-b border-border/50 pb-4">
            <div className="flex justify-between items-center text-sm mb-2 text-muted-foreground">
              <span>{homeTeamName}</span>
              <span className="font-bold text-foreground">vs</span>
              <span>{awayTeamName}</span>
            </div>
            TIE DETAILS
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {rubbers.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-4">No rubbers found for this tie.</p>
          )}

          {rubbers.map(rubber => {
            const needsTwoPlayers = rubber.matchType.includes("doubles");

            return (
              <div key={rubber.id} className="border border-border rounded-lg bg-background/50 overflow-hidden flex flex-col md:flex-row">
                <div className="bg-muted/30 px-3 py-2 border-b md:border-b-0 md:border-r border-border flex md:flex-col items-center justify-between md:justify-center w-full md:w-32 shrink-0">
                  <span className="text-primary font-bold display-font text-lg">Rubber {rubber.order}</span>
                  <Badge variant="outline" className="border-primary/30 uppercase tracking-wider text-[9px]">{rubber.matchType.replace("_", " ")}</Badge>
                </div>

                <div className="p-3 flex-1 grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
                  <div className="text-right flex flex-col gap-1">
                    <span className="text-sm font-semibold truncate text-foreground">{getPlayerName(rubber.homePlayerIds[0])}</span>
                    {needsTwoPlayers && (
                      <span className="text-sm font-semibold truncate text-foreground">{getPlayerName(rubber.homePlayerIds[1])}</span>
                    )}
                  </div>

                  <div className="flex flex-col items-center justify-center min-w-[4rem]">
                    {(rubber.games?.length ?? 0) > 0 ? rubber.games!.map((game, index) => (
                      <div key={index} className="text-sm font-bold mono-font text-foreground" data-testid={`score-rubber-${rubber.id}-game-${index + 1}`}>
                        {game.homeScore}&nbsp;:&nbsp;{game.awayScore}
                      </div>
                    )) : (
                      <div className="text-lg font-bold mono-font text-muted-foreground">-&nbsp;:&nbsp;-</div>
                    )}
                    {rubber.played && (
                      <div className="mt-1 border-t border-primary/20 pt-1 text-xs font-bold mono-font text-primary">
                        {rubber.homeScore}&nbsp;–&nbsp;{rubber.awayScore}
                      </div>
                    )}
                  </div>

                  <div className="text-left flex flex-col gap-1">
                    <span className="text-sm font-semibold truncate text-foreground">{getPlayerName(rubber.awayPlayerIds[0])}</span>
                    {needsTwoPlayers && (
                      <span className="text-sm font-semibold truncate text-foreground">{getPlayerName(rubber.awayPlayerIds[1])}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {isKnockout && (() => {
            const dreambreaker = teamEventState.dreambreakers.find((item) => item.knockoutMatchId === matchId);
            if (!dreambreaker) return null;
            const playerNames = (ids: number[]) => ids.map((id) => getPlayerName(id));
            const activeIndex = Math.floor(((dreambreaker.homeScore ?? 0) + (dreambreaker.awayScore ?? 0)) / 4) % 4;
            const activeHome = getPlayerName(dreambreaker.homePlayerIds[activeIndex]);
            const activeAway = getPlayerName(dreambreaker.awayPlayerIds[activeIndex]);
            return (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3" data-testid="spectator-dreambreaker">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-primary">Dreambreaker</h3>
                    <p className="text-xs text-muted-foreground">Singles rotation changes after every four rallies · First to 21, win by two</p>
                  </div>
                  <div className="text-xl font-bold mono-font">
                    {dreambreaker.homeScore ?? "–"} : {dreambreaker.awayScore ?? "–"}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{homeTeamName}</div>
                    {playerNames(dreambreaker.homePlayerIds).map((name, index) => <div key={index} className="text-sm">{index + 1}. {name}</div>)}
                    {dreambreaker.homePlayerIds.length === 0 && <div className="text-sm text-muted-foreground">Rotation pending</div>}
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{awayTeamName}</div>
                    {playerNames(dreambreaker.awayPlayerIds).map((name, index) => <div key={index} className="text-sm">{index + 1}. {name}</div>)}
                    {dreambreaker.awayPlayerIds.length === 0 && <div className="text-sm text-muted-foreground">Counter-lineup pending</div>}
                  </div>
                </div>
                {dreambreaker.homePlayerIds.length === 4 && dreambreaker.awayPlayerIds.length === 4 && !dreambreaker.played && (
                  <div className="rounded-md border border-primary/20 bg-background/50 p-2 text-center text-xs">
                    Current four-rally block: <span className="font-semibold text-foreground">{activeHome} vs {activeAway}</span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
