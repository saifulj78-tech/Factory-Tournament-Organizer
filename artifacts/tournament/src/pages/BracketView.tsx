import { Check, Edit2, Play, X, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KnockoutMatch } from "@workspace/api-client-react";

export interface ScoreEdit { matchId: number; homeScore: string; awayScore: string; }

interface RoundData { round: string; label: string; matches: KnockoutMatch[]; }

interface BracketViewProps {
  rounds: RoundData[];
  readOnly?: boolean;
  selectedTeamId?: number | null;
  knockoutScore: ScoreEdit | null;
  setKnockoutScore: (s: ScoreEdit | null) => void;
  onSave: (matchId: number) => void;
  onStart: (matchId: number) => void;
  isPending: boolean;
  isStarting: boolean;
  isTeamEvent?: boolean;
  onOpenTeamEventTie?: (match: KnockoutMatch) => void;
}

// Layout constants (px)
const CARD_W = 200;
const CARD_H = 90;
const COL_GAP = 60;   // horizontal gap between columns (connector lines live here)
const BASE_SLOT = 120; // vertical slot height for round-1 matches

// Bracket connector colour (semi-transparent white works on dark cards)
const LINE_COLOR = "rgba(255,255,255,0.15)";
const LINE_W = 1.5;

export function BracketView({ rounds, readOnly = false, selectedTeamId = null, knockoutScore, setKnockoutScore, onSave, onStart, isPending, isStarting, isTeamEvent = false, onOpenTeamEventTie }: BracketViewProps) {
  if (rounds.length === 0) return null;

  const cardWidth = readOnly ? CARD_W : 260;
  const cardHeight = readOnly ? CARD_H : 200;
  const baseSlot = readOnly ? BASE_SLOT : 230;
  const firstCount = rounds[0].matches.length;
  const totalH = firstCount * baseSlot;
  const totalW = rounds.length * (cardWidth + COL_GAP);

  // Pre-compute Y-centres for every match in every round
  const roundLayouts = rounds.map((r, ri) => {
    const slotH = baseSlot * Math.pow(2, ri);
    const centers = r.matches.map((_, mi) => slotH / 2 + mi * slotH);
    return { ...r, slotH, centers };
  });

  return (
    <div className="overflow-x-auto pb-6 select-none">

      {/* ── Column labels ── */}
      <div className="flex mb-4" style={{ minWidth: totalW }}>
        {roundLayouts.map((r) => (
          <div
            key={r.round}
            className="shrink-0 text-center"
            style={{ width: cardWidth + COL_GAP }}
          >
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {r.label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Bracket canvas ── */}
      <div className="relative" style={{ height: totalH, minWidth: totalW }}>

        {roundLayouts.map((r, ri) => {
          const colLeft = ri * (cardWidth + COL_GAP);
          const isFinalRound = ri === rounds.length - 1 && r.round !== "third_place";

          return (
            <div key={r.round}>

              {/* Match cards */}
              {r.matches.map((match, mi) => {
                const cardTop = r.centers[mi] - cardHeight / 2;
                 const isEditing = !readOnly && !isTeamEvent && knockoutScore?.matchId === match.id;
                const homeWon = match.played && match.homeScore != null && match.awayScore != null && match.homeScore > match.awayScore;
                const awayWon = match.played && match.homeScore != null && match.awayScore != null && match.awayScore > match.homeScore;
                const hasBothTeams = !!match.homeTeamId && !!match.awayTeamId;
                const isAutoWin = match.played && !hasBothTeams;

                return (
                  <div
                    key={match.id}
                    className={`absolute rounded-lg border overflow-hidden transition-all group ${
                      isFinalRound
                        ? "border-yellow-400/40 shadow-lg shadow-yellow-400/5"
                        : match.played
                        ? "border-primary/30"
                        : !hasBothTeams
                        ? "border-border/30 opacity-50"
                        : "border-border hover:border-border/80"
                    } ${isEditing ? "ring-1 ring-primary/60 z-10" : ""}
                      ${readOnly && selectedTeamId != null
                        ? match.homeTeamId === selectedTeamId || match.awayTeamId === selectedTeamId
                          ? "ring-1 ring-primary/60 z-10"
                          : "opacity-40"
                        : ""} bg-card`}
                    style={{ top: cardTop, left: colLeft, width: cardWidth, height: cardHeight }}
                  >
                    {/* Header */}
                    <div className="h-5 px-2 bg-muted/40 border-b border-border/50 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground mono-font">
                        {isFinalRound && <Trophy className="inline w-2.5 h-2.5 text-yellow-400 mr-0.5 -mt-0.5" />}
                        M{match.matchNumber}
                      </span>
                      {match.winnerName && (
                        <span className="text-[10px] text-yellow-400 font-semibold truncate ml-1 max-w-[110px]">
                          WINNER: {match.winnerName}
                        </span>
                      )}
                      {match.startedAt && !match.played && (
                        <span className="text-[9px] font-bold uppercase tracking-wide text-orange-400">Live</span>
                      )}
                    </div>

                    {/* Body */}
                    {isAutoWin ? (
                      <div className="h-[calc(100%-20px)] flex items-center justify-center px-2 text-xs font-semibold text-primary">
                        {match.homeTeamName ?? match.awayTeamName} — bye
                      </div>
                    ) : (
                      <div className={`flex flex-col h-[calc(100%-20px)] ${!readOnly ? "pb-14" : ""}`}>
                        {/* Home row */}
                        <div className={`flex-1 flex items-center gap-1.5 px-2 border-b border-border/30 ${homeWon ? "bg-primary/10" : ""}`}>
                          <span className={`flex-1 min-w-0 ${readOnly ? "text-xs" : "text-sm"} font-semibold truncate ${homeWon ? "text-primary" : !match.homeTeamId ? "text-muted-foreground/50 italic" : "text-foreground"}`}>
                            {match.homeTeamName ?? (match.homeTeamId ? `#${match.homeTeamId}` : "TBD")}
                          </span>
                          {isEditing ? (
                            <Input
                              value={knockoutScore!.homeScore}
                              onChange={e => setKnockoutScore({ ...knockoutScore!, homeScore: e.target.value })}
                              className="w-20 h-12 shrink-0 text-center bg-background border-border text-base p-2"
                              aria-label={`${match.homeTeamName ?? "Home team"} score`}
                              type="number" inputMode="numeric" min={0} autoFocus
                              onKeyDown={e => { if (e.key === "Enter") onSave(match.id); if (e.key === "Escape") setKnockoutScore(null); }}
                            />
                          ) : match.played ? (
                            <span className={`text-sm font-bold mono-font w-6 text-center shrink-0 ${homeWon ? "text-primary" : "text-foreground"}`}>{match.homeScore}</span>
                          ) : null}
                        </div>

                        {/* Away row */}
                        <div className={`flex-1 flex items-center gap-1.5 px-2 ${awayWon ? "bg-primary/10" : ""}`}>
                          <span className={`flex-1 min-w-0 ${readOnly ? "text-xs" : "text-sm"} font-semibold truncate ${awayWon ? "text-primary" : !match.awayTeamId ? "text-muted-foreground/50 italic" : "text-foreground"}`}>
                            {match.awayTeamName ?? (match.awayTeamId ? `#${match.awayTeamId}` : "TBD")}
                          </span>
                          {isEditing ? (
                            <Input
                              value={knockoutScore!.awayScore}
                              onChange={e => setKnockoutScore({ ...knockoutScore!, awayScore: e.target.value })}
                              className="w-20 h-12 shrink-0 text-center bg-background border-border text-base p-2"
                              aria-label={`${match.awayTeamName ?? "Away team"} score`}
                              type="number" inputMode="numeric" min={0}
                              onKeyDown={e => { if (e.key === "Enter") onSave(match.id); if (e.key === "Escape") setKnockoutScore(null); }}
                            />
                          ) : match.played ? (
                            <span className={`text-sm font-bold mono-font w-6 text-center shrink-0 ${awayWon ? "text-primary" : "text-foreground"}`}>{match.awayScore}</span>
                          ) : null}
                        </div>
                      </div>
                    )}

                    {/* Hover: enter score */}
                     {!readOnly && hasBothTeams && !isEditing && !isAutoWin && (
                      <div className="absolute inset-x-0 bottom-0 h-14 flex items-center justify-center gap-3 border-t border-border/50 bg-muted/90 rounded-b-lg">
                        {isTeamEvent ? (
                          <button
                            className="min-h-11 px-3 text-sm text-white font-semibold"
                            onClick={() => onOpenTeamEventTie?.(match)}
                            data-testid={`button-manage-knockout-tie-${match.id}`}
                          >
                            Lineups & Scores
                          </button>
                        ) : (
                          <>
                         {!match.startedAt && !match.played && (
                          <button
                            className="min-h-11 px-3 text-sm text-white font-semibold gap-1 inline-flex items-center"
                            onClick={() => onStart(match.id)}
                            disabled={isStarting}
                          >
                            <Play className="h-3 w-3" /> Start
                          </button>
                        )}
                          <button
                            className="min-h-11 px-3 text-sm text-white font-semibold gap-1 inline-flex items-center"
                            onClick={() => setKnockoutScore({ matchId: match.id, homeScore: match.homeScore?.toString() ?? "", awayScore: match.awayScore?.toString() ?? "" })}
                        >
                          <Edit2 className="h-4 w-4" /> {match.played ? "Edit score" : "Enter score"}
                        </button>
                          </>
                        )}
                      </div>
                    )}

                    {/* Save/cancel buttons when editing */}
                    {isEditing && (
                      <div className="absolute bottom-0 inset-x-0 p-2 flex justify-between gap-4 z-20 border-t border-border/50 bg-card">
                        <Button variant="outline" className="h-11 flex-1 px-3 text-green-400 hover:text-green-300 hover:bg-green-400/10" onClick={() => onSave(match.id)} disabled={isPending}>
                          <Check className="h-4 w-4 mr-1" /> Save
                        </Button>
                        <Button variant="outline" className="h-11 flex-1 px-3 text-destructive hover:bg-destructive/10" onClick={() => setKnockoutScore(null)} disabled={isPending}>
                          <X className="h-4 w-4 mr-1" /> Cancel
                        </Button>
                      </div>
                    )}

                     {readOnly && isTeamEvent && hasBothTeams && onOpenTeamEventTie && (
                       <button
                         type="button"
                         className="absolute bottom-0 right-1 text-[10px] font-bold text-primary hover:underline focus-visible:underline"
                         onClick={() => onOpenTeamEventTie(match)}
                       >
                         {match.played ? "View tie results" : "View lineups"}
                       </button>
                     )}
                  </div>
                );
              })}

              {/* SVG connector lines → next round */}
              {ri < rounds.length - 1 && (
                <svg
                  className="absolute pointer-events-none"
                    style={{ top: 0, left: colLeft, width: cardWidth + COL_GAP, height: totalH, overflow: "visible" }}
                >
                  {r.matches.reduce<React.ReactNode[]>((acc, _, mi) => {
                    if (mi % 2 !== 0) return acc; // process pairs: (0,1), (2,3), …
                    if (!r.matches[mi + 1]) return acc; // odd last match (shouldn't happen in power-of-2)

                    const topY = r.centers[mi];
                    const botY = r.centers[mi + 1];
                    const midY = (topY + botY) / 2;
                    const rx = cardWidth;         // right edge of this column's cards
                    const mx = cardWidth + COL_GAP / 2; // midpoint in the gap
                    const nx = cardWidth + COL_GAP;     // left edge of next column

                    acc.push(
                      <g key={mi} stroke={LINE_COLOR} strokeWidth={LINE_W} fill="none" strokeLinecap="round" strokeLinejoin="round">
                        {/* Horizontal from top card right edge → mid-gap */}
                        <line x1={rx} y1={topY} x2={mx} y2={topY} />
                        {/* Vertical joining the two horizontals */}
                        <line x1={mx} y1={topY} x2={mx} y2={botY} />
                        {/* Horizontal from bottom card right edge → mid-gap */}
                        <line x1={rx} y1={botY} x2={mx} y2={botY} />
                        {/* Output: mid-gap → next column left edge */}
                        <line x1={mx} y1={midY} x2={nx} y2={midY} />
                      </g>
                    );
                    return acc;
                  }, [])}
                </svg>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
