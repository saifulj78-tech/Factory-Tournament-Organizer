import { useEffect, useRef, useState, useMemo, type KeyboardEvent } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  useGetTournamentById,
  useListTournamentGroups,
  useListTournamentStandings,
  useListTournamentMatches,
  useListKnockoutMatches,
  useGetWildcardPlayoff,
  useListLadderState,
  getGetTournamentByIdQueryKey,
  getListTournamentGroupsQueryKey,
  getListTournamentStandingsQueryKey,
  getListTournamentMatchesQueryKey,
  getListKnockoutMatchesQueryKey,
  getGetWildcardPlayoffQueryKey,
  getListLadderStateQueryKey,
  getGetBreakoutKnockoutsQueryKey,
  type KnockoutMatch,
  type LadderState,
  type LadderGame,
  type LadderParticipant,
  type LadderTeam,
} from "@workspace/api-client-react";
import { Activity, Trophy, Swords, Clock, Zap, Wifi, WifiOff, Users, X, ArrowLeft, Flame, Info, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGetTeamEventState, getGetTeamEventStateQueryKey } from "@workspace/api-client-react";
import { SpectatorTieDialog } from "./spectator-tie-dialog";
import { BracketView } from "./BracketView";
import { formatPointsPerGame, getQualificationStatuses, getBreakoutQualificationStatuses } from "@/lib/qualification";
import { WildcardPlayoffPanel } from "./WildcardPlayoffPanel";
import { Top6Info, isTop6VirtualBye } from "./Top6Info";
import { BreakoutKnockoutsPanel, isGroupBasedFormat, useBreakoutState } from "./BreakoutKnockouts";

const ROUND_LABELS: Record<string, string> = {
  r32: "Round of 32", r16: "Round of 16", quarter: "Quarterfinal", semi: "Semifinal", third_place: "Third Place Playoff", final: "Final",
};
const ROUNDS_ORDER = ["r32", "r16", "quarter", "semi", "final"];

function getDoubleElimLabel(round: string, maxWBRound: number, maxLBRound: number): string {
  if (round === "grand_final") return "Grand Final";
  if (round === "grand_final_reset") return "Grand Final — Reset";
  if (round.startsWith("w")) { const n = parseInt(round.slice(1)); return n === maxWBRound ? "WB Final" : `WB Round ${n}`; }
  if (round.startsWith("l")) { const n = parseInt(round.slice(1)); return n === maxLBRound ? "LB Final" : `LB Round ${n}`; }
  return round;
}

/** Fallback polling interval — used when SSE is disconnected */
const FALLBACK_INTERVAL = 30_000;

/** Hook that opens an SSE connection and invalidates React Query caches on update events.
 *  Returns the current connection state: "connecting" | "live" | "fallback" */
function useTournamentSSE(tournamentId: number): "connecting" | "live" | "fallback" {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"connecting" | "live" | "fallback">("connecting");
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let destroyed = false;
    let retryDelay = 1_000;

    function invalidateAll() {
      queryClient.invalidateQueries({ queryKey: getGetTournamentByIdQueryKey(tournamentId) });
      queryClient.invalidateQueries({ queryKey: getListTournamentGroupsQueryKey(tournamentId) });
      queryClient.invalidateQueries({ queryKey: getListTournamentStandingsQueryKey(tournamentId) });
      queryClient.invalidateQueries({ queryKey: getListTournamentMatchesQueryKey(tournamentId) });
      queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
      queryClient.invalidateQueries({ queryKey: getGetWildcardPlayoffQueryKey(tournamentId) });
      queryClient.invalidateQueries({ queryKey: getListLadderStateQueryKey(tournamentId) });
      queryClient.invalidateQueries({ queryKey: getGetTeamEventStateQueryKey(tournamentId) });
      queryClient.invalidateQueries({ queryKey: getGetBreakoutKnockoutsQueryKey(tournamentId) });
    }

    function connect() {
      if (destroyed) return;
      setStatus("connecting");

      const es = new EventSource(`/api/tournaments/${tournamentId}/events`);
      esRef.current = es;

      es.addEventListener("connected", () => {
        if (destroyed) { es.close(); return; }
        setStatus("live");
        retryDelay = 1_000; // reset backoff on successful connection
      });

      es.addEventListener("update", () => {
        if (destroyed) return;
        invalidateAll();
      });

      es.onerror = () => {
        if (destroyed) return;
        es.close();
        esRef.current = null;
        setStatus("fallback");
        // Exponential backoff capped at 30 s
        retryTimer.current = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30_000);
          connect();
        }, retryDelay);
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [tournamentId, queryClient]);

  return status;
}

/** Searchable team picker dropdown */
function TeamPicker({
  teams,
  selectedTeamId,
  onSelect,
}: {
  teams: { id: number; name: string }[];
  selectedTeamId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return teams;
    const q = query.toLowerCase();
    return teams.filter(t => t.name.toLowerCase().includes(q));
  }, [teams, query]);

  const selectedTeam = teams.find(t => t.id === selectedTeamId);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(o => !o); setQuery(""); }}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors
          ${selectedTeamId
            ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/20"
            : "bg-card border-border text-foreground hover:bg-muted/60"
          }`}
      >
        <Users className="w-4 h-4 shrink-0" />
        <span className="max-w-[160px] truncate">
          {selectedTeam ? selectedTeam.name : "All teams"}
        </span>
        {selectedTeamId && (
          <span
            role="button"
            tabIndex={0}
            className="ml-1 text-primary/70 hover:text-primary"
            onClick={e => { e.stopPropagation(); onSelect(null); setOpen(false); }}
            onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); onSelect(null); setOpen(false); } }}
          >
            <X className="w-3.5 h-3.5" />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search teams…"
              className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm outline-none focus:border-primary/50 placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            <button
              onClick={() => { onSelect(null); setOpen(false); setQuery(""); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors
                ${selectedTeamId == null ? "text-primary font-semibold bg-primary/5" : "text-muted-foreground"}`}
            >
              Show all teams
            </button>
            {filtered.map(team => (
              <button
                key={team.id}
                onClick={() => { onSelect(team.id); setOpen(false); setQuery(""); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors truncate
                  ${selectedTeamId === team.id ? "text-primary font-semibold bg-primary/5" : "text-foreground"}`}
              >
                {team.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">No teams found</div>
            )}
          </div>
        </div>
      )}
        </div>
  );
}

function TeamBlock({ team }: { team: LadderTeam }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="w-full bg-[#1a0505] border border-[#3a0a0a]/80 rounded-lg p-1.5 sm:p-2 flex flex-col items-center justify-center shadow-inner relative overflow-hidden group min-h-[50px] sm:min-h-[64px]">
      <div className="absolute inset-0 bg-gradient-to-b from-[#fefce8]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex flex-col w-full gap-1 sm:gap-1.5">
        <AnimatePresence mode="popLayout">
          {team.players.map((p) => (
            <motion.div
              layoutId={prefersReducedMotion ? undefined : `player-${p.id}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: "spring", stiffness: 350, damping: 25, mass: 1.5 }}
              key={p.id}
              className="text-[#fefce8] font-bold text-sm sm:text-lg leading-tight sm:leading-tight text-center uppercase w-full truncate px-1 bg-[#3a0a0a]/40 rounded py-0.5 sm:py-1 relative z-10 hover:bg-[#5a0f0f] transition-colors cursor-default shadow-sm border border-[#eab308]/10"
              whileHover={prefersReducedMotion ? {} : { scale: 1.03, y: -2 }}
              whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
            >
              {p.name}
              <span className="text-[#eab308] text-[9px] sm:text-[11px] ml-1 opacity-80 font-black">#{p.seed}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function CourtZone({ title, game }: { title: string, game?: LadderGame | null }) {
  return (
    <div className="border-2 border-[#eab308]/40 bg-[#0a0202]/90 backdrop-blur-sm rounded-xl shadow-[0_0_15px_rgba(234,179,8,0.15)] flex flex-col shrink-0">
      <div className="bg-gradient-to-r from-[#2a0404] via-[#4a0808] to-[#2a0404] border-b-2 border-[#eab308]/30 p-1.5 sm:p-2 text-center shrink-0 rounded-t-lg">
        <h3 className="text-[#fefce8] font-black display-font text-xl sm:text-2xl uppercase tracking-wider drop-shadow">{title}</h3>
      </div>
      <div className="p-2 sm:p-3 flex flex-col justify-center gap-2 sm:gap-3 flex-1 min-h-[120px] sm:min-h-[160px]">
        {game ? (
          <>
            <TeamBlock team={game.homeTeam} />
            <div className="flex items-center justify-center -my-1 sm:-my-2 relative z-10">
               <span className="bg-[#050101] text-[#eab308] text-[10px] sm:text-xs font-black px-2 py-0.5 rounded-full border border-[#eab308]/30 uppercase tracking-widest shadow-md">VS</span>
            </div>
            <TeamBlock team={game.awayTeam} />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[#eab308]/20 gap-2 min-h-[120px] sm:min-h-[160px]">
            <Swords className="w-8 h-8 opacity-20" />
            <span className="font-bold uppercase text-sm tracking-widest">Open</span>
          </div>
        )}
      </div>
    </div>
  )
}

function BenchZone({ title, players }: { title: string, players: LadderParticipant[] }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="border-2 border-[#ea580c]/40 bg-[#1a0505]/60 backdrop-blur-sm rounded-xl shadow-[0_0_15px_rgba(234,88,12,0.1)] flex flex-col shrink-0 flex-1 relative overflow-hidden group">
      <div className="bg-gradient-to-r from-[#2a0404] via-[#4a0808]/60 to-[#2a0404] border-b-2 border-[#ea580c]/30 p-1 sm:p-1.5 text-center shrink-0 rounded-t-lg">
        <h3 className="text-[#ea580c] font-black display-font text-lg sm:text-xl uppercase tracking-wider">{title}</h3>
      </div>
      <div className="p-2 sm:p-3 flex flex-col items-stretch justify-start gap-1.5 sm:gap-2 flex-1 relative z-10">
         <AnimatePresence mode="popLayout">
           {players.length > 0 ? players.map(p => (
             <motion.div
               layoutId={prefersReducedMotion ? undefined : `player-${p.id}`}
               initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 40, rotate: 6 }}
               animate={{ opacity: 1, x: 0, rotate: 0 }}
               exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -40, rotate: -6, scale: 0.9 }}
               transition={{ type: "spring", stiffness: 350, damping: 25, mass: 1.5 }}
               key={p.id}
               className="text-[#fefce8] font-bold text-xs sm:text-sm text-center uppercase bg-black/40 border border-[#ea580c]/50 rounded-md px-2 py-1 sm:py-1.5 truncate cursor-default hover:bg-[#3a0a0a]/40 hover:border-[#ea580c]/80 transition-colors shadow-sm"
               whileHover={prefersReducedMotion ? {} : { scale: 1.03, x: 2 }}
               whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
             >
               {p.name} <span className="text-[#ea580c]/80 text-[9px] sm:text-[10px] ml-1 font-black">#{p.seed}</span>
             </motion.div>
           )) : (
             <motion.div
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               key="empty-bench"
               className="flex flex-col items-center justify-center h-full text-[#ea580c]/30 gap-1 sm:gap-2 min-h-[60px]"
             >
               <span className="font-bold uppercase text-xs sm:text-sm tracking-widest">Empty</span>
             </motion.div>
           )}
         </AnimatePresence>
      </div>
    </div>
  )
}

function MobileLocationRow({ title, players, bench = false }: { title: string; players: LadderParticipant[]; bench?: boolean }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className={`rounded-lg border px-3 py-2 flex flex-col ${bench ? "border-[#ea580c]/50 bg-[#1a0505]/80" : "border-[#eab308]/50 bg-[#1a0505]"}`}>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className={`shrink-0 font-black display-font text-base uppercase tracking-wider ${bench ? "text-[#ea580c]" : "text-[#eab308]"}`}>{title}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#eab308]/70">{players.length} players</span>
      </div>
      <div className="flex flex-wrap gap-1.5 min-h-[22px]">
        <AnimatePresence mode="popLayout">
          {players.length > 0 ? players.map((player) => (
            <motion.div
              layoutId={prefersReducedMotion ? undefined : `mobile-player-${player.id}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              key={player.id}
              className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded border ${bench ? "bg-black/40 border-[#ea580c]/50 text-[#fefce8]" : "bg-[#3a0a0a]/60 border-[#5a0f0f] text-[#fefce8]"}`}
            >
              {player.name}
            </motion.div>
          )) : (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              key="empty-mobile"
              className="text-[11px] font-bold uppercase text-white/20 mt-0.5"
            >
              Empty
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function LadderSpectatorView({ ladderState, tournamentName, sseStatus, isAmericano = false }: { ladderState: LadderState, tournamentName: string, sseStatus: "connecting" | "live" | "fallback", isAmericano?: boolean }) {
  const standingsScrollRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!ladderState.started) return;

    let frameId = 0;
    let direction = 1;
    let previousTime = performance.now();
    let pauseUntil = previousTime + 1_500;

    const scroll = (time: number) => {
      const container = standingsScrollRef.current;
      if (!container) return;

      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll > 1 && time >= pauseUntil) {
        const elapsed = Math.min(time - previousTime, 50);
        container.scrollTop += direction * elapsed * 0.025;

        if (container.scrollTop >= maxScroll - 1) {
          container.scrollTop = maxScroll;
          direction = -1;
          pauseUntil = time + 1_500;
        } else if (container.scrollTop <= 1) {
          container.scrollTop = 0;
          direction = 1;
          pauseUntil = time + 1_500;
        }
      }

      previousTime = time;
      frameId = requestAnimationFrame(scroll);
    };

    frameId = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frameId);
  }, [ladderState.started, ladderState.standings.length]);

  if (!ladderState.started) {
    return (
      <div className="min-h-screen bg-[#050101] flex flex-col items-center justify-center text-center space-y-4 text-[#fefce8] p-4 selection:bg-[#eab308] selection:text-[#050101]">
        <Zap className="w-16 h-16 text-[#eab308] opacity-50 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
        <h2 className="text-2xl sm:text-4xl font-bold display-font uppercase tracking-wider text-[#eab308]">Tournament Not Started</h2>
        <p className="text-[#fefce8]/70 max-w-md font-bold">The organizer is preparing the first batch. Matches and standings will appear here once the ladder begins.</p>
      </div>
    );
  }

  const resultsList = ladderState.history.slice().reverse().slice(0, 10);
  const hasResults = resultsList.length > 0;

  const court1 = ladderState.courts.find(c => c.courtNumber === 1);
  const court2 = ladderState.courts.find(c => c.courtNumber === 2);
  const court3 = ladderState.courts.find(c => c.courtNumber === 3);
  const latePlayers = ladderState.participants.filter((player) => !player.isHere);
  const playersOnCourt = (game?: LadderGame | null) => game
    ? [...game.homeTeam.players, ...game.awayTeam.players]
    : [];

  return (
    <div className="h-[100dvh] bg-[#050101] text-[#fefce8] font-sans flex flex-col overflow-hidden z-50 selection:bg-[#eab308] selection:text-[#050101] animate-in fade-in duration-500" data-testid="section-ladder-spectator">
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scroll::-webkit-scrollbar { display: none; }
        .hide-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes broadcast-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-broadcast-marquee {
          animation: broadcast-marquee 30s linear infinite;
        }
      `}} />

      {/* Header */}
      <header className="border-b-2 border-[#eab308]/30 bg-[#120202] px-4 py-3 sm:px-6 sm:py-4 flex justify-between items-end shrink-0 shadow-[0_4px_20px_rgba(0,0,0,0.4)] z-20">
         <div className="flex flex-col gap-1 sm:gap-2 min-w-0">
            <div className="flex items-center gap-3">
               {sseStatus === "live" ? (
                 <div className="flex items-center gap-2 px-2 py-0.5 bg-green-950/50 border border-green-800 rounded">
                   <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
                   <span className="text-green-400 text-[10px] font-bold uppercase tracking-widest">Live</span>
                 </div>
               ) : sseStatus === "connecting" ? (
                 <div className="flex items-center gap-2 px-2 py-0.5 bg-yellow-950/50 border border-yellow-800 rounded">
                   <Activity className="w-3 h-3 text-yellow-500 animate-spin" />
                   <span className="text-yellow-400 text-[10px] font-bold uppercase tracking-widest">Connecting</span>
                 </div>
               ) : (
                 <div className="flex items-center gap-2 px-2 py-0.5 bg-red-950/50 border border-red-800 rounded">
                   <WifiOff className="w-3 h-3 text-red-500" />
                   <span className="text-red-400 text-[10px] font-bold uppercase tracking-widest">Polling</span>
                 </div>
               )}
               <span className="text-[#eab308] text-[10px] sm:text-xs font-bold uppercase tracking-widest border-l-2 border-[#eab308]/50 pl-3">{isAmericano ? "Americano Social" : "Ladder Broadcast"}</span>
            </div>
            <h1 className="text-[#fefce8] font-black display-font text-3xl sm:text-5xl leading-none uppercase tracking-wide drop-shadow-sm truncate max-w-[60vw]" data-testid="text-tournament-name">{tournamentName}</h1>
         </div>
         <div className="text-right flex flex-col sm:flex-row items-end sm:items-baseline gap-1 sm:gap-3 shrink-0 pl-4">
            <span className="text-[#eab308]/80 text-[10px] sm:text-sm font-bold uppercase tracking-widest">Batch</span>
            <span className="text-[#eab308] font-black display-font text-4xl sm:text-6xl leading-none drop-shadow-[0_0_10px_rgba(234,179,8,0.3)]" data-testid="text-batch-number">{ladderState.batchNumber}</span>
         </div>
      </header>

      {/* Main Layout */}
      <main className="flex-1 min-h-0 flex flex-col xl:flex-row gap-4 lg:gap-6 p-2 sm:p-4 lg:p-6 w-full max-w-[1800px] mx-auto relative z-10 overflow-y-auto xl:overflow-hidden hide-scroll">
         <div className="absolute top-0 left-1/4 w-[50%] h-[50%] bg-[#eab308]/5 rounded-full blur-[120px] pointer-events-none" />

         {/* Left: Map */}
         <div className="flex flex-col gap-3 lg:gap-4 xl:flex-1 xl:min-h-0">
           <div className="md:hidden space-y-2">
             <MobileLocationRow title="Court 1" players={playersOnCourt(court1?.activeGame)} />
             <MobileLocationRow title="Court 2" players={playersOnCourt(court2?.activeGame)} />
             <MobileLocationRow title="Court 3" players={playersOnCourt(court3?.activeGame)} />
             <MobileLocationRow title="Bench 1" players={court1?.waitingPlayers ?? []} bench />
             <MobileLocationRow title="Bench 2" players={court3?.waitingPlayers ?? []} bench />
              {latePlayers.length > 0 && <MobileLocationRow title="Late Arrivals" players={latePlayers} bench />}
           </div>

           <div className="hidden flex-1 md:grid grid-cols-3 gap-3 sm:gap-4 overflow-y-auto hide-scroll pb-4 xl:pb-0">
             {/* Court 3 & Bench 2 Rotation Pair */}
             <div className="flex flex-col gap-3 sm:gap-4 bg-gradient-to-b from-[#2a0808]/50 to-red-950/10 p-2 sm:p-3 rounded-2xl border border-[#7f1d1d]/40 relative overflow-hidden group">
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03] pointer-events-none transition-transform duration-1000 group-hover:rotate-180">
                 <RefreshCw className="w-48 h-48 text-[#f5d547]" strokeWidth={1} />
               </div>
               <div className="relative z-10 flex flex-col gap-3 sm:gap-4 h-full">
                 <CourtZone title="Court 3" game={court3?.activeGame} />
                 <div className="flex items-center justify-center -my-3 sm:-my-4 relative z-20 pointer-events-none">
                    <div className="bg-[#120202] border-2 border-[#991b1b] rounded-full p-1 shadow-lg text-[#eab308]/70">
                      <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                 </div>
                 <BenchZone title="Bench 2" players={court3?.waitingPlayers || []} />
               </div>
             </div>

              {/* Court 2 and Bench 1 */}
              <div className="flex flex-col gap-3 sm:gap-4 p-2 sm:p-3">
               <div className="relative z-10 flex flex-col gap-3 sm:gap-4 h-full">
                 <CourtZone title="Court 2" game={court2?.activeGame} />
                 <BenchZone title="Bench 1" players={court1?.waitingPlayers || []} />
               </div>
             </div>

             {/* Court 1 */}
             <div className="flex flex-col gap-3 sm:gap-4 p-2 sm:p-3">
               <CourtZone title="Court 1" game={court1?.activeGame} />
             </div>
           </div>
            {latePlayers.length > 0 && (
              <div className="hidden md:flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-2">
                <span className="shrink-0 font-black display-font uppercase tracking-wider text-amber-400">Late Arrivals</span>
                <div className="flex flex-wrap gap-1.5">
                  {latePlayers.map((player) => (
                    <span key={player.id} className="rounded border border-amber-500/30 bg-black/30 px-2 py-1 text-xs font-bold uppercase text-amber-100">
                      {player.name} <span className="text-amber-400">#{player.seed}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
         </div>

         {/* Right: Standings */}
         <div className="w-full xl:w-[400px] 2xl:w-[480px] flex flex-col border border-[#3a0a0a] bg-[#0a0202]/80 backdrop-blur-sm rounded-xl overflow-hidden shadow-xl shrink-0 h-[500px] xl:h-full">
            <div className="bg-[#1a0505]/80 border-b border-[#3a0a0a] p-2 flex items-center justify-center shrink-0">
               <h2 className="text-[#eab308] font-black display-font text-2xl sm:text-3xl tracking-wider uppercase">{isAmericano ? "Americano Standings" : "Ladder Standings"}</h2>
            </div>
            <div ref={standingsScrollRef} className="flex-1 overflow-y-auto hide-scroll p-3 sm:p-5 flex flex-col gap-3">
              {/* Top 3 Big */}
              <div className="flex flex-col gap-2">
                <AnimatePresence mode="popLayout">
                {ladderState.standings.slice(0, 3).map((standing, idx) => {
                  const isFirst = idx === 0;
                  const isSecond = idx === 1;
                  return (
                  <motion.div
                     layout={!prefersReducedMotion}
                     initial={{ opacity: 0, scale: 0.95 }}
                     animate={{ opacity: 1, scale: 1 }}
                     exit={{ opacity: 0, scale: 0.95 }}
                     transition={{ type: "spring", stiffness: 350, damping: 25 }}
                     key={standing.player.id}
                     data-testid={`card-standing-${standing.rank}`}
                     className={`relative flex items-center justify-between p-3 sm:p-4 rounded-lg border ${isFirst ? 'bg-gradient-to-br from-[#eab308]/20 to-[#eab308]/5 border-[#eab308] shadow-[0_0_20px_-5px_rgba(234,179,8,0.4)]' : isSecond ? 'bg-gradient-to-br from-slate-300/15 to-slate-300/5 border-slate-300/40' : 'bg-gradient-to-br from-amber-600/15 to-amber-600/5 border-amber-600/40'}`}
                  >
                     {isFirst && (
                       <div className="absolute -top-2 -right-2 bg-[#eab308] text-[#050101] px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest shadow-md transform rotate-3">
                         Leader
                       </div>
                     )}
                     <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <span className={`font-black display-font text-5xl sm:text-6xl leading-none w-8 sm:w-10 text-center drop-shadow-md shrink-0 ${isFirst ? 'text-[#eab308]' : isSecond ? 'text-slate-300' : 'text-amber-600'}`}>{standing.rank}</span>
                        <div className="flex flex-col min-w-0 justify-center">
                           <span className="text-[#fefce8] font-black display-font text-2xl sm:text-3xl uppercase leading-none truncate">{standing.player.name}</span>
                           <div className="flex items-center gap-2 mt-1 sm:mt-2">
                             <span className="text-[#eab308]/80 text-[10px] sm:text-xs font-bold tracking-widest uppercase">{standing.wins}W - {standing.losses}L</span>
                             {standing.currentWinStreak >= 2 && (
                               <span className={`text-[9px] sm:text-[10px] font-black uppercase px-1.5 py-0.5 rounded flex items-center gap-0.5 leading-none shrink-0 ${standing.currentWinStreak >= 3 ? 'bg-orange-500 text-orange-950 shadow-[0_0_8px_rgba(249,115,22,0.6)] animate-pulse' : 'bg-[#eab308] text-[#050101]'}`}>{standing.currentWinStreak}W <Flame className="w-2.5 h-2.5" /></span>
                             )}
                           </div>
                        </div>
                     </div>
                     <div className="flex flex-col items-end justify-center shrink-0 pl-2">
                        <span className="text-[#eab308] font-black display-font text-4xl sm:text-5xl leading-none drop-shadow">{standing.points}</span>
                        <span className="text-[#eab308]/70 text-[10px] sm:text-xs uppercase font-bold tracking-widest mt-1">PTS</span>
                     </div>
                  </motion.div>
                )})}
                </AnimatePresence>
              </div>

              {/* Rest Small */}
              <div className="flex flex-col gap-1.5 mt-2">
                 <AnimatePresence mode="popLayout">
                 {ladderState.standings.slice(3).map(standing => (
                   <motion.div
                      layout={!prefersReducedMotion}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ type: "spring", stiffness: 350, damping: 25 }}
                      key={standing.player.id}
                      data-testid={`row-standing-${standing.rank}`}
                      className="flex items-center justify-between p-2 sm:p-2.5 rounded-lg bg-[#2a0808]/60 border border-[#7f1d1d]/60 hover:bg-[#7f1d1d]/50 transition-colors"
                   >
                      <div className="flex items-center gap-3 min-w-0">
                         <span className="text-[#eab308]/70 font-black display-font text-2xl leading-none w-6 sm:w-8 text-center shrink-0">{standing.rank}</span>
                         <div className="flex flex-col min-w-0">
                           <span className="text-[#fefce8]/90 font-bold uppercase text-xs sm:text-sm truncate">{standing.player.name}</span>
                         </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 pl-2">
                         {standing.currentWinStreak >= 2 && (
                           <span className="text-[10px] font-black uppercase text-orange-400 shrink-0 flex items-center gap-0.5"><Flame className="w-3 h-3" />{standing.currentWinStreak}</span>
                         )}
                         <span className="text-[#f5d547]/90 font-black display-font text-2xl leading-none w-8 text-right">{standing.points}</span>
                      </div>
                   </motion.div>
                 ))}
                 </AnimatePresence>
              </div>
           </div>
         </div>
      </main>

      {/* Footer Ticker: Recent Results */}
      <footer className="h-10 sm:h-12 border-t-2 border-[#f5d547]/30 bg-[#120202] flex items-center shrink-0 overflow-hidden relative z-20 shadow-[0_-4px_15px_rgba(0,0,0,0.3)]">
         <div className="absolute left-0 top-0 bottom-0 w-24 sm:w-32 bg-gradient-to-r from-[#120202] to-transparent z-10 pointer-events-none" />
         <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-l from-[#120202] to-transparent z-10 pointer-events-none" />

         <div className="absolute left-3 sm:left-4 z-20 bg-[#f5d547] text-[#120202] px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-black uppercase tracking-widest rounded shadow-md">
           Recent Results
          </div>

         <div className="flex-1 overflow-hidden ml-28 sm:ml-36 flex items-center h-full group">
            {hasResults ? (
              <div className="flex whitespace-nowrap w-max animate-broadcast-marquee motion-reduce:animate-none group-hover:[animation-play-state:paused]">
                <div className="flex gap-16 pr-16 items-center">
                  {resultsList.map((game) => (
                    <div key={game.id} className="flex items-center gap-3 bg-[#2a0808] px-3 py-1 rounded-full border border-[#7f1d1d]">
                       <span className="text-[#eab308] text-[10px] font-black uppercase tracking-widest">CT {game.courtNumber}</span>
                       <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#fefce8]">
                         <span>{game.homeTeam.players.map(p=>p.name).join(" & ")}</span>
                         <span className="text-[#f5d547]">{game.homeScore}</span>
                         <span className="text-[#eab308]/30">-</span>
                         <span className="text-[#f5d547]">{game.awayScore}</span>
                         <span>{game.awayTeam.players.map(p=>p.name).join(" & ")}</span>
                       </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-16 pr-16 items-center">
                  {resultsList.map((game) => (
                    <div key={`dup-${game.id}`} className="flex items-center gap-3 bg-[#2a0808] px-3 py-1 rounded-full border border-[#7f1d1d]">
                       <span className="text-[#eab308] text-[10px] font-black uppercase tracking-widest">CT {game.courtNumber}</span>
                       <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#fefce8]">
                         <span>{game.homeTeam.players.map(p=>p.name).join(" & ")}</span>
                         <span className="text-[#f5d547]">{game.homeScore}</span>
                         <span className="text-[#eab308]/30">-</span>
                         <span className="text-[#f5d547]">{game.awayScore}</span>
                         <span>{game.awayTeam.players.map(p=>p.name).join(" & ")}</span>
                       </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-[#eab308]/60 text-xs font-bold uppercase tracking-widest px-4">Waiting for first match results...</div>
            )}
         </div>
      </footer>
    </div>
  )
}

export default function Spectator() {
  const { id } = useParams<{ id: string }>();
  const tournamentId = Number(id);
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const selectedTab = new URLSearchParams(search).get("tab") === "knockout" ? "knockout" : "overview";

  function setSelectedTab(tab: "overview" | "knockout") {
    if (tab === selectedTab) return;
    const params = new URLSearchParams(search);
    if (tab === "knockout") params.set("tab", "knockout");
    else params.delete("tab");
    const qs = params.toString();
    setLocation(qs ? `${location}?${qs}` : location);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: "overview" | "knockout" | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") next = selectedTab === "overview" ? "knockout" : "overview";
    if (event.key === "Home") next = "overview";
    if (event.key === "End") next = "knockout";
    if (next) {
      event.preventDefault();
      setSelectedTab(next);
      document.getElementById(`spectator-tab-${next}`)?.focus();
    }
  }

  // Read selected team from URL
  const selectedTeamId = useMemo(() => {
    const params = new URLSearchParams(search);
    const v = params.get("team");
    const n = v ? parseInt(v, 10) : NaN;
    return isNaN(n) ? null : n;
  }, [search]);

  // Write selected team to URL
  function setSelectedTeamId(teamId: number | null) {
    const params = new URLSearchParams(search);
    if (teamId == null) {
      params.delete("team");
    } else {
      params.set("team", String(teamId));
    }
    const qs = params.toString();
    setLocation(qs ? `${location}?${qs}` : location, { replace: true });
  }

  const sseStatus = useTournamentSSE(tournamentId);

  // Keep fallback polling active — it kicks in automatically when SSE is disconnected
  // and provides a safety net even when SSE is live.
  const refetchInterval = sseStatus === "live" ? false : FALLBACK_INTERVAL;

  const { data: tournament } = useGetTournamentById(tournamentId, { query: { queryKey: getGetTournamentByIdQueryKey(tournamentId), refetchInterval } });
  const { data: groups } = useListTournamentGroups(tournamentId, { query: { queryKey: getListTournamentGroupsQueryKey(tournamentId), refetchInterval } });
  const { data: standings } = useListTournamentStandings(tournamentId, { query: { queryKey: getListTournamentStandingsQueryKey(tournamentId), refetchInterval } });
  const { data: matches } = useListTournamentMatches(tournamentId, { query: { queryKey: getListTournamentMatchesQueryKey(tournamentId), refetchInterval } });

  const isGroupKnockout = tournament?.format === "group_knockout";
  const showPPG = isGroupKnockout && tournament.wildcardRankingMethod === "ppg" && (tournament.wildcardQualifiers ?? 0) > 0;
  const isTeamEvent = tournament?.format === "team_event";
  const isAmericano = tournament?.format === "americano";
  const isIndividualLadder = tournament?.format === "individual_ladder" || isAmericano;

  const { data: knockoutMatchesRaw = [], isLoading: knockoutLoading, isError: knockoutError, refetch: refetchKnockout } = useListKnockoutMatches(tournamentId, {
    query: {
      queryKey: getListKnockoutMatchesQueryKey(tournamentId),
      enabled: isGroupKnockout || isTeamEvent,
      refetchInterval: isGroupKnockout || isTeamEvent ? refetchInterval : false,
    },
  });
  const knockoutMatches = knockoutMatchesRaw as KnockoutMatch[];
  const isGroupBased = isGroupBasedFormat(tournament?.format);
  const { data: breakoutState } = useBreakoutState(tournamentId, isGroupBased);
  const breakoutOn = isGroupBased && !!breakoutState?.enabled;
  const legacyKnockout = isGroupKnockout && !breakoutOn;
  const isWildcardPlayoff = (legacyKnockout || breakoutOn) && tournament?.wildcardSelectionMethod === "round_robin" && (breakoutOn ? (tournament?.wildcardQualifiers ?? 0) > 0 : true);
  const breakoutGenerated = breakoutOn && !!breakoutState?.brackets.some((b) => b.matches.length > 0);
  // After generation the bracket entrants are frozen; use them instead of live standings.
  const breakoutEntrants = breakoutGenerated ? breakoutState!.brackets.flatMap((b) => b.qualifiers) : null;
  const { data: wildcardPlayoff } = useGetWildcardPlayoff(tournamentId, {
    query: { queryKey: getGetWildcardPlayoffQueryKey(tournamentId), enabled: isWildcardPlayoff, refetchInterval: isWildcardPlayoff ? refetchInterval : false },
  });
  const playoffQualifiedIds = breakoutOn
    ? (wildcardPlayoff?.qualifiedTeamIds ?? null)
    : knockoutMatches.length > 0
    ? [...new Set(knockoutMatches.flatMap((match) => [match.homeTeamId, match.awayTeamId]).filter((id): id is number => id != null))]
    : (wildcardPlayoff?.qualifiedTeamIds ?? null);
  const hasStageTabs = legacyKnockout || isTeamEvent;

  const { data: teamEventState } = useGetTeamEventState(tournamentId, {
    query: {
      queryKey: getGetTeamEventStateQueryKey(tournamentId),
      enabled: isTeamEvent,
      refetchInterval: isTeamEvent ? refetchInterval : false,
    },
  });
  const currentStandings = isTeamEvent ? teamEventState?.standings : standings;
  const thirdPlaceTeamIds = wildcardPlayoff?.matches.length
    ? [...new Set(wildcardPlayoff.matches.flatMap((match) => [match.homeTeamId, match.awayTeamId]))]
    : (groups ?? []).map((group) => currentStandings?.filter((row) => row.groupId === group.id)[2]?.teamId).filter((id): id is number => id != null);
  const selectedThirdPlaceTeamIds = thirdPlaceTeamIds.filter((teamId) =>
    knockoutMatches.some((match) => match.homeTeamId === teamId || match.awayTeamId === teamId));
  const showQualification = legacyKnockout || isTeamEvent || breakoutOn;
  const qualificationStatuses = breakoutOn && breakoutState
    ? getBreakoutQualificationStatuses(breakoutState.brackets, tournament?.qualifiersPerGroup ?? 1)
    : showQualification && groups && currentStandings
    ? getQualificationStatuses(
        currentStandings as any[],
        groups.map((group) => group.id),
        isTeamEvent ? 2 : (tournament?.qualifiersPerGroup ?? 1),
        isTeamEvent ? 0 : (tournament?.wildcardQualifiers ?? 0),
        isTeamEvent,
        tournament?.tiebreakerOrder,
        tournament?.wildcardRankingMethod ?? "points",
        isWildcardPlayoff ? playoffQualifiedIds : undefined,
        isWildcardPlayoff && !breakoutOn && knockoutMatches.length > 0 ? playoffQualifiedIds ?? [] : undefined,
      )
    : new Map<number, "automatic" | "additional">();

  const [tieDialogParams, setTieDialogParams] = useState<{ matchId: number, isKnockout: boolean, homeId: number|null, awayId: number|null, homeName: string|null, awayName: string|null } | null>(null);
  const { data: ladderState } = useListLadderState(tournamentId, {
    query: {
      queryKey: getListLadderStateQueryKey(tournamentId),
      enabled: isIndividualLadder,
      refetchInterval: isIndividualLadder ? refetchInterval : false,
    },
  });

  // Build sorted team list from standings + matches
  const allTeams = useMemo(() => {
    const map = new Map<number, string>();
    currentStandings?.forEach(s => map.set(s.teamId, s.teamName));
    matches?.forEach(m => {
      if (m.homeTeamId && m.homeTeamName) map.set(m.homeTeamId, m.homeTeamName);
      if (m.awayTeamId && m.awayTeamName) map.set(m.awayTeamId, m.awayTeamName);
    });
    knockoutMatches.forEach(m => {
      if (m.homeTeamId && m.homeTeamName) map.set(m.homeTeamId, m.homeTeamName);
      if (m.awayTeamId && m.awayTeamName) map.set(m.awayTeamId, m.awayTeamName);
    });
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [currentStandings, matches, knockoutMatchesRaw]);

  // Recent results: if filtered, show only team's matches; otherwise last 10
  const allRecentResults = matches?.filter(m => m.played).slice(-10).reverse() ?? [];
  const recentResults = selectedTeamId != null
    ? (matches?.filter(m => m.played && (m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId)).reverse() ?? [])
    : allRecentResults;

  const groupById = Object.fromEntries((groups ?? []).map(g => [g.id, g]));

  // Started matches are shown separately from fixtures that are still waiting to begin.
  const nowPlayingMatchesAll = matches?.filter(m => !m.played && !!m.startedAt) ?? [];
  const nowPlayingMatches = selectedTeamId != null
    ? nowPlayingMatchesAll.filter(m => m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId)
    : nowPlayingMatchesAll;
  const nowPlayingKnockoutMatchesAll = knockoutMatches.filter(
    m => !m.played && !!m.startedAt && m.homeTeamId != null && m.awayTeamId != null,
  );
  const nowPlayingKnockoutMatches = selectedTeamId != null
    ? nowPlayingKnockoutMatchesAll.filter(m => m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId)
    : nowPlayingKnockoutMatchesAll;

  // Find the next not-yet-started round for the followed team (or everyone).
  const unplayed = matches?.filter(m => !m.played && !m.startedAt) ?? [];
  const upcomingForSelection = selectedTeamId != null
    ? unplayed.filter(m => m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId)
    : unplayed;
  const nextRound = upcomingForSelection.length > 0 ? Math.min(...upcomingForSelection.map(m => m.roundNumber)) : null;
  const nextRoundMatchesAll = nextRound != null ? unplayed.filter(m => m.roundNumber === nextRound) : [];
  const nextRoundMatches = selectedTeamId != null
    ? nextRoundMatchesAll.filter(m => m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId)
    : nextRoundMatchesAll;
  const courts = [...new Set(nextRoundMatches.map(m => m.courtNumber).filter(c => c != null))].sort((a, b) => (a ?? 0) - (b ?? 0));
  const matchesByCourt = Object.fromEntries(courts.map(c => [c!, nextRoundMatches.filter(m => m.courtNumber === c)]));

  // Next 5 matches per court after the current round, grouped by court
  const afterCurrentAll = nextRound != null
    ? unplayed.filter(m => m.roundNumber > nextRound)
    : [];
  const afterCurrent = selectedTeamId != null
    ? afterCurrentAll.filter(m => m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId)
    : afterCurrentAll;
  const upNextCourts = [...new Set(afterCurrent.map(m => m.courtNumber).filter(c => c != null))].sort((a, b) => (a ?? 0) - (b ?? 0));
  const upNextByCourt = Object.fromEntries(
    upNextCourts.map(c => [c!, afterCurrent.filter(m => m.courtNumber === c).slice(0, 5)])
  );

  // For knockout, track whether the selected team has any match in a given round
  function teamInKnockoutRound(round: string) {
    if (selectedTeamId == null) return false;
    return knockoutMatches.some(
      m => m.round === round && (m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId)
    );
  }

  const selectedTeamName = allTeams.find(t => t.id === selectedTeamId)?.name;

  if (isIndividualLadder && ladderState) {
    return <LadderSpectatorView ladderState={ladderState} tournamentName={tournament.name} sseStatus={sseStatus} isAmericano={isAmericano} />;
  }

  return (
    <div className="min-h-screen bg-background dark text-foreground">
      {/* Header */}
      <div className="bg-card border-b border-border px-3 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
        <button
          type="button"
          aria-label="Go back"
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else setLocation("/");
          }}
          className="shrink-0 rounded-md border border-border p-2 text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Activity className="w-6 h-6 sm:w-7 sm:h-7 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">Spectator View</div>
          <h1 className="text-lg sm:text-2xl font-bold display-font tracking-wide text-foreground leading-none truncate">
            {tournament?.name ?? "Loading..."}
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {tournament?.status === "completed" && (
            <Badge variant="secondary" className="text-xs uppercase tracking-wider">Completed</Badge>
          )}
          {sseStatus === "live" ? (
            <div className="flex items-center gap-1.5 text-xs text-green-400">
              <Wifi className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Live</span>
            </div>
          ) : sseStatus === "fallback" ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <WifiOff className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Auto-refreshes every 30s</span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground hidden sm:block">Connecting…</div>
          )}
        </div>
      </div>

      {/* Team filter bar */}
      {allTeams.length > 0 && (
        <div className="bg-card/60 border-b border-border px-3 sm:px-6 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground uppercase tracking-wider shrink-0">Follow team:</span>
          <TeamPicker
            teams={allTeams}
            selectedTeamId={selectedTeamId}
            onSelect={setSelectedTeamId}
          />
          {selectedTeamId != null && selectedTeamName && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Showing matches &amp; results for <span className="text-primary font-semibold">{selectedTeamName}</span>
            </span>
          )}
        </div>
      )}

      {hasStageTabs && (
        <nav className="border-b border-border bg-[#160707]" aria-label="Tournament stages">
          <div className="max-w-7xl mx-auto px-3 sm:px-6">
            <div role="tablist" aria-label="Tournament stages" className="flex gap-1 sm:gap-3" onKeyDown={onTabKeyDown}>
              <button id="spectator-tab-overview" type="button" role="tab" aria-controls="spectator-panel-overview"
                aria-selected={selectedTab === "overview"} tabIndex={selectedTab === "overview" ? 0 : -1}
                onClick={() => setSelectedTab("overview")} data-testid="button-tab-overview"
                className={`relative flex min-h-14 flex-1 sm:flex-none items-center justify-center gap-2 px-3 sm:px-6 text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-primary ${selectedTab === "overview" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-card"}`}>
                <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Live overview</span>
                {selectedTab === "overview" && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
              </button>
              <button id="spectator-tab-knockout" type="button" role="tab" aria-controls="spectator-panel-knockout"
                aria-selected={selectedTab === "knockout"} tabIndex={selectedTab === "knockout" ? 0 : -1}
                onClick={() => setSelectedTab("knockout")} data-testid="button-tab-knockout"
                className={`relative flex min-h-14 flex-1 sm:flex-none items-center justify-center gap-2 px-3 sm:px-6 text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-primary ${selectedTab === "knockout" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-card"}`}>
                <Trophy className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Knockout round</span>
                {nowPlayingKnockoutMatchesAll.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-orange-400" aria-label="Matches in progress" />}
                {selectedTab === "knockout" && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
              </button>
            </div>
          </div>
        </nav>
      )}

      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-8 sm:space-y-10">
        {hasStageTabs && selectedTab !== "overview" && (
          <div id="spectator-panel-overview" role="tabpanel" aria-labelledby="spectator-tab-overview" hidden />
        )}
        {(!hasStageTabs || selectedTab === "overview") && (
          <div id="spectator-panel-overview" role={hasStageTabs ? "tabpanel" : undefined} aria-labelledby={hasStageTabs ? "spectator-tab-overview" : undefined} tabIndex={hasStageTabs ? 0 : undefined} className="space-y-8 sm:space-y-10 outline-none focus-visible:ring-2 focus-visible:ring-primary/60">

        {/* Standings */}
        {groups && groups.length > 0 && (
          <section>
            <div className="flex items-center gap-2 sm:gap-3 mb-1">
              <Trophy className="w-5 h-5 text-primary shrink-0" />
              <h2 className="text-xl sm:text-2xl font-bold display-font tracking-wide">STANDINGS</h2>
            </div>
            {isTeamEvent && (
              <p className="mb-4 sm:mb-5 text-xs text-muted-foreground">
                TW/TD/TL: team-tie results · IW/IL: individual rubber results · SF/SA: total score for/against · SD: score difference
              </p>
            )}
            {!isTeamEvent && <div className="mb-4 sm:mb-5" />}
            {showQualification && (
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Qualification legend">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-green-400" />Automatic qualifier</span>
                {!isTeamEvent && (tournament?.wildcardQualifiers ?? 0) > 0 && (
                  <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />Additional qualifier</span>
                )}
                {breakoutOn && <span>{breakoutGenerated ? "Final breakout entrants." : "Provisional. Qualifiers go to the breakout bracket for their group."}</span>}
                {isWildcardPlayoff ? <span>The third-place playoff decides the two additional places.</span> : showPPG && <span>Additional qualifiers compared by PPG (points ÷ games played).</span>}
              </div>
            )}
            <div className="overflow-x-auto pb-2 -mx-1 px-1" data-testid="grid-group-cards">
            <div className={`grid grid-flow-col ${groups.length === 3 ? "grid-rows-1" : "grid-rows-[auto_auto]"} auto-cols-[minmax(min(22rem,85vw),1fr)] items-start gap-4 sm:gap-6 w-max min-w-full`}>
              {groups
                .filter(group =>
                  // If filtering, only show groups that contain the selected team
                  selectedTeamId == null ||
                  (currentStandings?.some(s => s.groupId === group.id && s.teamId === selectedTeamId))
                )
                .map((group) => {
                  const groupStandings = currentStandings?.filter(s => s.groupId === group.id) ?? [];
                  return (
                    <Card key={group.id} className="bg-card border border-border overflow-hidden">
                      <div className="bg-muted/50 px-3 sm:px-4 py-2 border-b border-border">
                        <span className="font-bold display-font text-base sm:text-lg tracking-wide text-primary">{group.name}</span>
                      </div>
                      <div className="overflow-x-auto">
                         <table className={`w-full text-xs ${isTeamEvent ? "min-w-[520px]" : showPPG ? "min-w-[360px]" : "min-w-[280px]"}`}>
                          <thead>
                            <tr className="border-b border-border/50 bg-background/20">
                              <th className="text-left px-3 py-2 text-muted-foreground font-medium">Team</th>
                              <th className="text-center px-2 py-2 text-muted-foreground font-medium">P</th>
                              {isTeamEvent ? (
                                <>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium" title="Team-tie wins">TW</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium" title="Team-tie draws">TD</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium" title="Team-tie losses">TL</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium" title="Individual rubber wins">IW</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium" title="Individual rubber losses">IL</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium" title="Individual rubber difference">ID</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium" title="Total score points for">SF</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium" title="Total score points against">SA</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium" title="Score difference: points scored minus points conceded">SD</th>
                                </>
                              ) : (
                                <>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium">W</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium">L</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium" title="Total score for">SF</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium" title="Total score against">SA</th>
                                  <th className="text-center px-2 py-2 text-muted-foreground font-medium">GD</th>
                                </>
                              )}
                              <th className="text-center px-3 py-2 text-primary font-semibold">PTS</th>
                               {showPPG && <th className="text-center px-2 py-2 text-primary font-semibold" title="Points per game: points divided by games played">PPG</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {groupStandings.map((s, idx) => {
                              const gd = s.goalsFor - s.goalsAgainst;
                              const teamEventScores = s as typeof s & {
                                scoreFor?: number;
                                scoreAgainst?: number;
                                rallyDifference?: number;
                              };
                              const scoreDifference = teamEventScores.rallyDifference ?? 0;
                              const isSelected = selectedTeamId != null && s.teamId === selectedTeamId;
                              const qualificationStatus = qualificationStatuses.get(s.teamId);
                              const qualifierColor = qualificationStatus === "additional" ? "text-yellow-400" : qualificationStatus === "automatic" ? "text-green-400" : "";
                              return (
                                <tr
                                  key={s.teamId}
                                  className={`border-b border-border/30 transition-colors
                                    ${isSelected
                                      ? `${qualificationStatus === "additional" ? "bg-yellow-500/5" : qualificationStatus === "automatic" ? "bg-green-500/5" : "bg-primary/10"} ring-1 ring-inset ring-primary/30`
                                      : qualificationStatus === "additional" ? "bg-yellow-500/5" : qualificationStatus === "automatic" ? "bg-green-500/5" : idx === 0 ? "bg-primary/5" : ""
                                    }
                                    ${selectedTeamId != null && !isSelected ? "opacity-50" : ""}
                                  `}
                                >
                                  <td className="px-3 py-2 max-w-[120px]">
                                    <div className="flex items-center gap-1.5">
                                      <span className={`${qualifierColor || "text-muted-foreground"} w-3 shrink-0`}>{idx + 1}</span>
                                      <span className={`font-semibold truncate ${qualifierColor || (isSelected ? "text-primary" : idx === 0 ? "text-primary" : "text-foreground")}`}>
                                        {s.teamName}
                                      </span>
                                      {isSelected && <span className="text-primary text-[10px] shrink-0 font-bold uppercase">Following</span>}
                                    </div>
                                  </td>
                                  <td className="text-center px-2 py-2 mono-font text-muted-foreground">{s.played}</td>
                                  {isTeamEvent ? (
                                    <>
                                      <td className="text-center px-2 py-2 mono-font text-green-400">{s.wins}</td>
                                      <td className="text-center px-2 py-2 mono-font text-amber-400">{s.draws}</td>
                                      <td className="text-center px-2 py-2 mono-font text-red-400">{s.losses}</td>
                                      <td className="text-center px-2 py-2 mono-font text-green-400">{s.goalsFor}</td>
                                      <td className="text-center px-2 py-2 mono-font text-red-400">{s.goalsAgainst}</td>
                                      <td className={`text-center px-2 py-2 mono-font ${gd > 0 ? "text-green-400" : gd < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                                        {gd > 0 ? `+${gd}` : gd}
                                      </td>
                                      <td className="text-center px-2 py-2 mono-font text-green-400">{teamEventScores.scoreFor ?? 0}</td>
                                      <td className="text-center px-2 py-2 mono-font text-red-400">{teamEventScores.scoreAgainst ?? 0}</td>
                                      <td className={`text-center px-2 py-2 mono-font ${scoreDifference > 0 ? "text-green-400" : scoreDifference < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                                        {scoreDifference > 0 ? `+${scoreDifference}` : scoreDifference}
                                      </td>
                                    </>
                                  ) : (
                                    <>
                                      <td className="text-center px-2 py-2 mono-font text-green-400">{s.wins}</td>
                                      <td className="text-center px-2 py-2 mono-font text-red-400">{s.losses}</td>
                                      <td className="text-center px-2 py-2 mono-font text-green-400">{s.goalsFor}</td>
                                      <td className="text-center px-2 py-2 mono-font text-red-400">{s.goalsAgainst}</td>
                                      <td className={`text-center px-2 py-2 mono-font ${gd > 0 ? "text-green-400" : gd < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                                        {gd > 0 ? `+${gd}` : gd}
                                      </td>
                                    </>
                                  )}
                                  <td className="text-center px-3 py-2">
                                    <span className={`font-bold mono-font text-sm ${qualifierColor || (isSelected || idx === 0 ? "text-primary" : "text-foreground")}`}>{s.points}</span>
                                  </td>
                                   {showPPG && <td className="text-center px-2 py-2 mono-font text-foreground">{formatPointsPerGame(s.points, s.played)}</td>}
                                </tr>
                              );
                            })}
                            {groupStandings.length === 0 && (
                               <tr><td colSpan={isTeamEvent ? 12 : showPPG ? 9 : 8} className="px-3 py-4 text-center text-muted-foreground">No results yet</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  );
                })}
            </div>
            </div>
          </section>
        )}

        {breakoutOn && (
          <section id="spectator-breakouts" aria-label="Breakout knockouts">
            <BreakoutKnockoutsPanel tournamentId={tournamentId} groups={groups ?? []} />
          </section>
        )}

        {isWildcardPlayoff && (
          <WildcardPlayoffPanel tournamentId={tournamentId} organizer={false} canStart={false} hasBracket={breakoutOn ? breakoutGenerated : knockoutMatches.length > 0} selectedTeamIds={breakoutOn ? undefined : selectedThirdPlaceTeamIds} onManualSelection={() => {}} />
        )}

        {/* Now Playing */}
        {(nowPlayingMatches.length > 0 || nowPlayingKnockoutMatches.length > 0) && (
          <section data-testid="section-now-playing">
            <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
              <Activity className="w-5 h-5 text-orange-400 shrink-0 animate-pulse" />
              <h2 className="text-xl sm:text-2xl font-bold display-font tracking-wide">NOW PLAYING</h2>
              <Badge variant="outline" className="border-orange-400/40 text-orange-400 text-[10px] uppercase tracking-widest">
                Live
              </Badge>
              {selectedTeamId != null && (
                <span className="text-xs text-muted-foreground">(filtered to {selectedTeamName})</span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {nowPlayingMatches.map((match) => {
                const group = groupById[match.groupId];
                const homeIsSelected = selectedTeamId != null && match.homeTeamId === selectedTeamId;
                const awayIsSelected = selectedTeamId != null && match.awayTeamId === selectedTeamId;
                return (
                  <Card key={`group-${match.id}`} className="border border-orange-400/40 bg-orange-400/5 overflow-hidden" data-testid={`card-now-playing-match-${match.id}`}>
                    <div className="px-3 sm:px-4 py-2 border-b border-orange-400/20 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold mono-font text-orange-400 uppercase tracking-widest">
                        {match.courtNumber != null ? `Court ${match.courtNumber}` : "Court TBD"}
                      </span>
                      <Badge variant="outline" className="border-orange-400/40 text-orange-400 text-[10px]">In progress</Badge>
                    </div>
                    <div className="p-3 sm:p-4">
                      <div className="flex justify-between gap-3 mb-3 text-xs text-muted-foreground">
                        <span className="truncate">{group?.name ?? "Group stage"}</span>
                        <span className="mono-font shrink-0">Round {match.roundNumber}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`flex-1 text-right text-sm font-semibold min-w-0 truncate ${homeIsSelected ? "text-primary" : "text-foreground"}`}>
                          {match.homeTeamName ?? `#${match.homeTeamId}`}
                        </span>
                        <Swords className="w-4 h-4 text-orange-400 shrink-0" />
                        <span className={`flex-1 text-sm font-semibold min-w-0 truncate ${awayIsSelected ? "text-primary" : "text-foreground"}`}>
                          {match.awayTeamName ?? `#${match.awayTeamId}`}
                        </span>
                      </div>
                      {isTeamEvent && (
                        <div className="mt-3 text-center border-t border-orange-400/20 pt-2">
                          <button
                            onClick={() => setTieDialogParams({ matchId: match.id, isKnockout: false, homeId: match.homeTeamId ?? null, awayId: match.awayTeamId ?? null, homeName: match.homeTeamName ?? "", awayName: match.awayTeamName ?? "" })}
                            className="text-[10px] uppercase tracking-wider font-bold text-orange-400 hover:text-orange-300 transition-colors"
                          >
                            View Live Tie
                          </button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
              {nowPlayingKnockoutMatches.map((match) => {
                const homeIsSelected = selectedTeamId != null && match.homeTeamId === selectedTeamId;
                const awayIsSelected = selectedTeamId != null && match.awayTeamId === selectedTeamId;
                return (
                  <Card key={`knockout-${match.id}`} className="border border-orange-400/40 bg-orange-400/5 overflow-hidden" data-testid={`card-now-playing-knockout-${match.id}`}>
                    <div className="px-3 sm:px-4 py-2 border-b border-orange-400/20 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold mono-font text-orange-400 uppercase tracking-widest">Knockout · {match.round}</span>
                      <Badge variant="outline" className="border-orange-400/40 text-orange-400 text-[10px]">In progress</Badge>
                    </div>
                    <div className="p-3 sm:p-4">
                      <div className="flex items-center gap-2">
                        <span className={`flex-1 text-right text-sm font-semibold min-w-0 truncate ${homeIsSelected ? "text-primary" : "text-foreground"}`}>
                          {match.homeTeamName ?? "TBD"}
                        </span>
                        <Swords className="w-4 h-4 text-orange-400 shrink-0" />
                        <span className={`flex-1 text-sm font-semibold min-w-0 truncate ${awayIsSelected ? "text-primary" : "text-foreground"}`}>
                          {match.awayTeamName ?? "TBD"}
                        </span>
                      </div>
                      {isTeamEvent && (
                        <div className="mt-3 text-center border-t border-orange-400/20 pt-2">
                          <button
                            onClick={() => setTieDialogParams({ matchId: match.id, isKnockout: true, homeId: match.homeTeamId ?? null, awayId: match.awayTeamId ?? null, homeName: match.homeTeamName ?? "", awayName: match.awayTeamName ?? "" })}
                            className="text-[10px] uppercase tracking-wider font-bold text-orange-400 hover:text-orange-300 transition-colors"
                            data-testid={`button-view-live-knockout-tie-${match.id}`}
                          >
                            View Live Tie
                          </button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Up Next — by court */}
        {nextRound != null && nextRoundMatches.length > 0 && (
          <section>
            <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
              <Clock className="w-5 h-5 text-blue-400 shrink-0" />
              <h2 className="text-xl sm:text-2xl font-bold display-font tracking-wide">UP NEXT</h2>
              <span className="text-xs mono-font text-muted-foreground">Round {nextRound}</span>
            </div>
            {courts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {courts.map((court) => (
                  <div key={court} className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="bg-orange-500/10 border-b border-orange-500/30 px-3 sm:px-4 py-2 flex items-center gap-2">
                      <span className="text-sm font-bold mono-font text-orange-400 uppercase tracking-widest">Court {court}</span>
                    </div>
                    <div className="divide-y divide-border/50">
                      {matchesByCourt[court!]?.map((match) => {
                        const group = groupById[match.groupId];
                        const homeIsSelected = selectedTeamId != null && match.homeTeamId === selectedTeamId;
                        const awayIsSelected = selectedTeamId != null && match.awayTeamId === selectedTeamId;
                        return (
                          <div key={match.id} className="px-3 sm:px-4 py-3 sm:py-4">
                            <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">{group?.name ?? ""}</div>
                            <div className="flex items-center gap-2">
                              <span className={`flex-1 text-right text-sm font-semibold leading-tight min-w-0 truncate ${homeIsSelected ? "text-primary" : "text-foreground"}`}>
                                {match.homeTeamName ?? `#${match.homeTeamId}`}
                              </span>
                              <span className="text-muted-foreground text-xs font-bold uppercase tracking-widest shrink-0">vs</span>
                              <span className={`flex-1 text-sm font-semibold leading-tight min-w-0 truncate ${awayIsSelected ? "text-primary" : "text-foreground"}`}>
                                {match.awayTeamName ?? `#${match.awayTeamId}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center border border-dashed border-border rounded-lg text-muted-foreground text-sm">
                {selectedTeamName} has no matches in round {nextRound}
              </div>
            )}
          </section>
        )}

        {/* Later rounds — by court */}
        {(upNextCourts.length > 0 || (selectedTeamId != null && afterCurrentAll.some(m => m.homeTeamId === selectedTeamId || m.awayTeamId === selectedTeamId))) && (
          <section>
            <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
              <Clock className="w-5 h-5 text-muted-foreground shrink-0" />
              <h2 className="text-xl sm:text-2xl font-bold display-font tracking-wide">LATER ROUNDS</h2>
            </div>
            {upNextCourts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {upNextCourts.map((court) => (
                  <div key={court} className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="bg-muted/30 border-b border-muted/50 px-3 sm:px-4 py-2 flex items-center gap-2">
                      <span className="text-sm font-bold mono-font text-muted-foreground uppercase tracking-widest">Court {court}</span>
                    </div>
                    <div className="divide-y divide-border/50">
                      {upNextByCourt[court!]?.map((match) => {
                        const group = groupById[match.groupId];
                        const homeIsSelected = selectedTeamId != null && match.homeTeamId === selectedTeamId;
                        const awayIsSelected = selectedTeamId != null && match.awayTeamId === selectedTeamId;
                        return (
                          <div key={match.id} className="px-3 sm:px-4 py-2.5 sm:py-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs text-muted-foreground uppercase tracking-wider">{group?.name ?? ""}</span>
                              <span className="text-xs mono-font text-muted-foreground shrink-0 ml-2">Round {match.roundNumber}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`flex-1 text-right text-sm font-semibold leading-tight min-w-0 truncate ${homeIsSelected ? "text-primary" : "text-foreground"}`}>
                                {match.homeTeamName ?? `#${match.homeTeamId}`}
                              </span>
                              <span className="text-muted-foreground text-xs font-bold uppercase tracking-widest shrink-0">vs</span>
                              <span className={`flex-1 text-sm font-semibold leading-tight min-w-0 truncate ${awayIsSelected ? "text-primary" : "text-foreground"}`}>
                                {match.awayTeamName ?? `#${match.awayTeamId}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        )}
          </div>
        )}

        {/* Knockout Bracket */}
        {hasStageTabs && selectedTab !== "knockout" && (
          <div id="spectator-panel-knockout" role="tabpanel" aria-labelledby="spectator-tab-knockout" hidden />
        )}
        {hasStageTabs && selectedTab === "knockout" && (
          <div id="spectator-panel-knockout" role="tabpanel" aria-labelledby="spectator-tab-knockout" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
            {knockoutLoading ? (
              <div className="space-y-6 motion-safe:animate-pulse" role="status" aria-label="Loading knockout bracket">
                <div className="h-28 rounded-xl bg-card border border-border" />
                <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="h-32 rounded-lg bg-card border border-border" />)}</div>
              </div>
            ) : knockoutError ? (
              <div className="min-h-64 rounded-xl border border-destructive/30 bg-card p-8 flex flex-col items-center justify-center text-center">
                <h2 className="text-3xl text-foreground">Bracket unavailable</h2>
                <p className="mt-1 text-sm text-muted-foreground">We couldn't load the knockout matches. Your live overview is still available.</p>
                <button type="button" onClick={() => void refetchKnockout()} data-testid="button-retry-knockout" className="mt-5 rounded border border-primary/60 px-5 py-2 text-sm font-bold text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary">Try again</button>
              </div>
            ) : knockoutMatches.length === 0 ? (
              <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-card min-h-[360px] flex flex-col items-center justify-center px-6 py-12 text-center">
                <div aria-hidden="true" className="absolute inset-0 opacity-40 pointer-events-none" style={{ background: "repeating-linear-gradient(135deg, transparent 0px, transparent 32px, hsl(var(--primary) / .06) 33px, transparent 34px)" }} />
                <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary"><Trophy className="h-8 w-8" /></div>
                <p className="relative z-10 mt-7 text-[11px] font-bold uppercase tracking-[.3em] text-primary">The road to the title</p>
                <h2 className="relative z-10 mt-2 text-4xl sm:text-6xl leading-none font-bold display-font">The bracket is taking shape.</h2>
                <p className="relative z-10 mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">Knockout fixtures will appear here once the organizer sets the draw. Keep this tab open — it updates as matches are added.</p>
                {selectedTeamName && <p className="relative z-10 mt-5 text-xs text-primary">Following {selectedTeamName}</p>}
              </div>
            ) : (() => {
          const isDoubleElim = knockoutMatches.some(m => (m as any).bracket === "winner");
          const isTop6 = (tournament as { knockoutFormat?: string } | undefined)?.knockoutFormat === "top6";

          const wbRoundKeys = [...new Set(knockoutMatches.filter(m => (m as any).bracket === "winner").map(m => m.round))].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
          const lbRoundKeys = [...new Set(knockoutMatches.filter(m => (m as any).bracket === "loser").map(m => m.round))].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
          const maxWBRound = wbRoundKeys.length ? Math.max(...wbRoundKeys.map(r => parseInt(r.slice(1)))) : 0;
          const maxLBRound = lbRoundKeys.length ? Math.max(...lbRoundKeys.map(r => parseInt(r.slice(1)))) : 0;

          const renderMatchCard = (match: KnockoutMatch, round: string) => {
            if (match.played && (match.homeTeamId == null || match.awayTeamId == null)) return null; // bye — skip
            const homeWon = match.played && match.homeScore != null && match.awayScore != null && match.homeScore > match.awayScore;
            const awayWon = match.played && match.homeScore != null && match.awayScore != null && match.awayScore > match.homeScore;
            const isTbd = !match.homeTeamId || !match.awayTeamId;
            const isInProgress = !match.played && !!match.startedAt;
            const isFinalRound = round === "final" || round === "grand_final" || round === "grand_final_reset";
            const homeIsSelected = selectedTeamId != null && match.homeTeamId === selectedTeamId;
            const awayIsSelected = selectedTeamId != null && match.awayTeamId === selectedTeamId;
            const teamIsInMatch = homeIsSelected || awayIsSelected;
            return (
              <div
                key={match.id}
                className={`relative overflow-hidden bg-card border rounded-lg px-4 py-4 transition-opacity
                  ${isInProgress ? "border-orange-400/70 bg-orange-400/10" : isFinalRound ? "border-primary/60 bg-primary/5" : match.played ? "border-primary/25" : isTbd ? "border-border/40 opacity-60" : "border-border"}
                  ${selectedTeamId != null && !teamIsInMatch ? "opacity-40" : ""}
                  ${teamIsInMatch ? "ring-1 ring-primary/40" : ""}
                `}
                data-testid={`card-knockout-match-${match.id}`}
              >
                {(isInProgress || isFinalRound) && <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${isInProgress ? "bg-orange-400" : "bg-primary"}`} />}
                <div className="text-[10px] text-muted-foreground mono-font mb-3 flex items-center justify-between gap-2 uppercase tracking-widest">
                  <span>Match {match.matchNumber}</span>
                  {isInProgress ? <span className="text-orange-400 font-bold">In progress</span> : isFinalRound ? <span className="text-primary font-bold">Title match</span> : match.played ? <span>Final score</span> : null}
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className={`flex-1 text-right text-sm font-semibold truncate min-w-0 ${homeWon ? "text-primary" : homeIsSelected ? "text-primary" : isTbd ? "text-muted-foreground italic" : "text-foreground"}`}>
                    {match.homeTeamName ?? "TBD"}
                  </span>
                  <div className="shrink-0 w-12 sm:w-16 text-center">
                    {match.played ? (
                      <span className="mono-font font-bold text-sm sm:text-base">
                        <span className={homeWon ? "text-primary" : "text-foreground"}>{match.homeScore}</span>
                        <span className="text-muted-foreground mx-0.5 sm:mx-1">–</span>
                        <span className={awayWon ? "text-primary" : "text-foreground"}>{match.awayScore}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground uppercase tracking-widest">{isTbd ? "TBD" : "vs"}</span>
                    )}
                  </div>
                  <span className={`flex-1 text-sm font-semibold truncate min-w-0 ${awayWon ? "text-primary" : awayIsSelected ? "text-primary" : isTbd ? "text-muted-foreground italic" : "text-foreground"}`}>
                    {match.awayTeamName ?? "TBD"}
                  </span>
                </div>
                {match.played && match.winnerName && (
                  <div className="mt-1.5 text-center text-[10px] sm:text-xs text-primary font-semibold">WINNER: {match.winnerName}</div>
                )}
                {isTeamEvent && !isTbd && (
                  <div className="mt-2 text-center">
                    <button
                      onClick={() => setTieDialogParams({ matchId: match.id, isKnockout: true, homeId: match.homeTeamId ?? null, awayId: match.awayTeamId ?? null, homeName: match.homeTeamName ?? "", awayName: match.awayTeamName ?? "" })}
                      className="text-[10px] uppercase tracking-wider font-bold text-primary hover:text-primary/80 transition-colors"
                    >
                      {match.played ? "View Tie Results" : "View Lineups"}
                    </button>
                  </div>
                )}
              </div>
            );
          };

          const renderRound = (round: string, label: string) => {
            const roundMatches = knockoutMatches.filter(m => m.round === round).sort((a, b) => a.matchNumber - b.matchNumber);
            const isFinalRound = round === "final" || round === "grand_final" || round === "grand_final_reset";
            const liveCount = roundMatches.filter(m => !m.played && !!m.startedAt).length;
            return (
              <div key={round} className={`rounded-xl border p-3 sm:p-5 ${isFinalRound ? "border-primary/30 bg-primary/[.04]" : "border-border/70 bg-card/30"}`}>
                <div className="flex items-center gap-2 sm:gap-3 mb-4">
                  {isFinalRound ? <Trophy className="w-4 h-4 text-yellow-400 shrink-0" /> : <Zap className="w-4 h-4 text-primary shrink-0" />}
                  <h3 className={`font-bold display-font tracking-wide uppercase ${isFinalRound ? "text-2xl text-primary" : "text-xl text-foreground"}`}>{label}</h3>
                  {selectedTeamId != null && teamInKnockoutRound(round) && (
                    <span className="text-xs text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded-full">Your team</span>
                  )}
                  <div className="flex-1 h-px bg-border" />
                  {liveCount > 0 && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-orange-400">{liveCount} live</span>}
                  <span className="shrink-0 text-[10px] mono-font text-muted-foreground">{roundMatches.length} {roundMatches.length === 1 ? "match" : "matches"}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
                  {roundMatches.map(match => renderMatchCard(match, round))}
                </div>
              </div>
            );
          };

          return (
            <section className="space-y-6" data-testid="section-knockout-round">
              <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-[#35100d] via-card to-background p-5 sm:p-8">
                <div aria-hidden="true" className="absolute -right-6 -top-14 text-[160px] sm:text-[230px] leading-none font-black display-font text-primary/[.07] rotate-[-12deg] select-none">K/O</div>
                <div className="relative z-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
                  <div>
                    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.28em] text-primary"><Trophy className="h-4 w-4" aria-hidden="true" /> The title run</p>
                    <h2 className="mt-3 text-4xl sm:text-7xl leading-[.95] font-bold display-font tracking-tight text-foreground">Knockout round<span className="text-primary">.</span></h2>
                    <p className="mt-4 max-w-lg text-sm text-muted-foreground">{isDoubleElim ? "Two paths through the draw. One champion at the end." : "Every match moves the field closer to the final."} {selectedTeamName ? `Following ${selectedTeamName}.` : "Follow a team to trace their route."}</p>
                  </div>
                  <div className="flex items-end gap-5 border-t border-primary/20 pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
                    <div><div className="text-3xl sm:text-4xl leading-none display-font text-foreground">{knockoutMatches.filter(m => !m.played && !!m.startedAt).length}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-orange-400">On court</div></div>
                    <div><div className="text-3xl sm:text-4xl leading-none display-font text-foreground">{knockoutMatches.filter(m => m.played).length}<span className="text-muted-foreground text-xl">/{knockoutMatches.length}</span></div><div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Decided</div></div>
                  </div>
                </div>
              </div>
              {knockoutMatches.some(m => !m.played && !!m.startedAt && m.homeTeamId != null && m.awayTeamId != null) && (
                <div className="rounded-xl border border-orange-400/40 bg-orange-400/[.06] p-4 sm:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-orange-400 motion-safe:animate-pulse" />
                    <h3 className="text-xl text-orange-400">On court now</h3>
                    <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">Live knockout matches</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {knockoutMatches.filter(m => !m.played && !!m.startedAt && m.homeTeamId != null && m.awayTeamId != null).map(m => renderMatchCard(m, m.round))}
                  </div>
                </div>
              )}
              {knockoutMatches.some(m => ["final", "grand_final", "grand_final_reset"].includes(m.round)) && (
                <div className="rounded-xl border border-primary/30 bg-primary/[.05] p-4 sm:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    <h3 className="text-xl text-primary">The final</h3>
                    <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">For the title</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {knockoutMatches.filter(m => ["final", "grand_final", "grand_final_reset"].includes(m.round)).map(m => renderMatchCard(m, m.round))}
                  </div>
                </div>
              )}
              {isTop6 && <div className="mb-6"><Top6Info testId="text-spectator-top6-info" /></div>}
              <div className="space-y-6 sm:space-y-8">
                {isDoubleElim ? (
                  <>
                    {/* Winner Bracket */}
                    {wbRoundKeys.length > 0 && (
                      <div className="space-y-6">
                        <div className="flex items-center gap-2">
                          <Trophy className="w-4 h-4 text-primary shrink-0" />
                          <h3 className="text-sm font-bold display-font tracking-widest text-primary uppercase">Winner Bracket</h3>
                          <div className="flex-1 h-px bg-primary/20" />
                        </div>
                        <div className="space-y-6 pl-3 border-l-2 border-primary/20">
                          {wbRoundKeys.map(r => renderRound(r, getDoubleElimLabel(r, maxWBRound, maxLBRound)))}
                        </div>
                      </div>
                    )}
                    {/* Loser Bracket */}
                    {lbRoundKeys.length > 0 && (
                      <div className="space-y-6">
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-orange-400 shrink-0" />
                          <h3 className="text-sm font-bold display-font tracking-widest text-orange-400 uppercase">Loser Bracket</h3>
                          <div className="flex-1 h-px bg-orange-400/20" />
                        </div>
                        <div className="space-y-6 pl-3 border-l-2 border-orange-400/20">
                          {lbRoundKeys.map(r => renderRound(r, getDoubleElimLabel(r, maxWBRound, maxLBRound)))}
                        </div>
                      </div>
                    )}
                    {/* Grand Final */}
                    {knockoutMatches.some(m => m.round === "grand_final") && renderRound("grand_final", "Grand Final")}
                    {/* Grand Final Reset — appears only when LB champion won the GF */}
                    {knockoutMatches.some(m => m.round === "grand_final_reset") && renderRound("grand_final_reset", "Grand Final — Reset")}
                  </>
                ) : (
                  <div className="flex flex-col xl:flex-row gap-6 items-start">
                    <div className="min-w-0 w-full flex-1" data-testid="spectator-knockout-bracket">
                      <div className="md:hidden space-y-4" aria-label="Knockout rounds">
                        {ROUNDS_ORDER.filter(round => knockoutMatches.some(m => m.round === round)).map(round => renderRound(round, ROUND_LABELS[round] ?? round))}
                      </div>
                      <div className="hidden md:block rounded-xl border border-border/70 bg-card/40 p-4 lg:p-6">
                        <p className="mb-4 text-[10px] uppercase tracking-[.2em] text-muted-foreground">Draw progression <span className="text-primary">/</span> Scroll horizontally to see every round</p>
                        <BracketView
                        readOnly
                        selectedTeamId={selectedTeamId}
                        rounds={ROUNDS_ORDER
                          .map(round => ({
                            round,
                            label: ROUND_LABELS[round] ?? round,
                            matches: knockoutMatches.filter(m => m.round === round && !(isTop6 && isTop6VirtualBye(m, "quarter"))).sort((a, b) => a.matchNumber - b.matchNumber),
                          }))
                          .filter(({ matches }) => matches.length > 0)}
                        knockoutScore={null}
                        setKnockoutScore={() => {}}
                        onSave={() => {}}
                        onStart={() => {}}
                        isPending={false}
                        isStarting={false}
                        isTeamEvent={isTeamEvent}
                        onOpenTeamEventTie={(match) => setTieDialogParams({
                          matchId: match.id, isKnockout: true,
                          homeId: match.homeTeamId ?? null, awayId: match.awayTeamId ?? null,
                          homeName: match.homeTeamName ?? "", awayName: match.awayTeamName ?? "",
                        })}
                        />
                      </div>
                    </div>
                    {knockoutMatches.some(m => m.round === "third_place") && (
                      <aside className="w-full xl:w-[280px] shrink-0 rounded-xl border border-border bg-card/50 p-4" aria-label="Third place playoff">
                        <h3 className="text-xl font-bold display-font uppercase tracking-wide mb-3 text-primary">Third Place Playoff</h3>
                        <div className="space-y-3">
                          {knockoutMatches.filter(m => m.round === "third_place").map(match => renderMatchCard(match, "third_place"))}
                        </div>
                      </aside>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })()}
          </div>
        )}

        {/* Recent Results */}
        {(!hasStageTabs || selectedTab === "overview") && (
          <div className="space-y-8 sm:space-y-10">
        {(recentResults.length > 0 || (selectedTeamId != null && allRecentResults.length > 0)) && (
          <section>
            <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
              <Swords className="w-5 h-5 text-orange-400 shrink-0" />
              <h2 className="text-xl sm:text-2xl font-bold display-font tracking-wide">RECENT RESULTS</h2>
              {selectedTeamId != null && (
                <span className="text-xs text-muted-foreground">(filtered to {selectedTeamName})</span>
              )}
            </div>
            {recentResults.length > 0 ? (
              <div className="space-y-2">
                {recentResults.map((match) => {
                  const group = groupById[match.groupId];
                  const homeWon = (match.homeScore ?? 0) > (match.awayScore ?? 0);
                  const awayWon = (match.awayScore ?? 0) > (match.homeScore ?? 0);
                  const homeIsSelected = selectedTeamId != null && match.homeTeamId === selectedTeamId;
                  const awayIsSelected = selectedTeamId != null && match.awayTeamId === selectedTeamId;
                  return (
                    <div key={match.id} className="flex items-center gap-2 sm:gap-3 bg-card border border-primary/20 rounded-md px-3 sm:px-4 py-2.5 sm:py-3">
                      <span className="text-xs text-muted-foreground w-10 sm:w-16 shrink-0 truncate">{group?.name ?? "?"}</span>
                      <span className={`flex-1 text-right text-xs sm:text-sm font-semibold min-w-0 truncate ${homeWon ? "text-primary" : homeIsSelected ? "text-primary/80" : "text-foreground"}`}>
                        {match.homeTeamName ?? `#${match.homeTeamId}`}
                      </span>
                      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                        <span className={`text-base sm:text-xl font-bold mono-font ${homeWon ? "text-primary" : "text-foreground"}`}>{match.homeScore}</span>
                        <span className="text-muted-foreground text-sm">–</span>
                        <span className={`text-base sm:text-xl font-bold mono-font ${awayWon ? "text-primary" : "text-foreground"}`}>{match.awayScore}</span>
                      </div>
                      <span className={`flex-1 text-xs sm:text-sm font-semibold min-w-0 truncate ${awayWon ? "text-primary" : awayIsSelected ? "text-primary/80" : "text-foreground"}`}>
                        {match.awayTeamName ?? `#${match.awayTeamId}`}
                      </span>
                      {isTeamEvent && (
                        <button
                          onClick={() => setTieDialogParams({ matchId: match.id, isKnockout: false, homeId: match.homeTeamId ?? null, awayId: match.awayTeamId ?? null, homeName: match.homeTeamName ?? "", awayName: match.awayTeamName ?? "" })}
                          className="ml-2 text-[10px] uppercase tracking-wider font-bold text-primary hover:text-primary/80 transition-colors shrink-0"
                        >
                          View Tie
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center border border-dashed border-border rounded-lg text-muted-foreground text-sm">
                No results yet for {selectedTeamName}
              </div>
            )}
          </section>
        )}

        {!isIndividualLadder && groups && groups.length === 0 && (
          <div className="py-16 sm:py-20 text-center border-2 border-dashed border-border rounded-lg">
            <p className="text-muted-foreground">Tournament hasn't started yet.</p>
          </div>
        )}
          </div>
        )}
      </div>
      {tieDialogParams && teamEventState && (
        <SpectatorTieDialog
          teamEventState={teamEventState}
          matchId={tieDialogParams.matchId}
          isKnockout={tieDialogParams.isKnockout}
          homeTeamId={tieDialogParams.homeId}
          awayTeamId={tieDialogParams.awayId}
          homeTeamName={tieDialogParams.homeName}
          awayTeamName={tieDialogParams.awayName}
          onClose={() => setTieDialogParams(null)}
        />
      )}
    </div>
  );
}
