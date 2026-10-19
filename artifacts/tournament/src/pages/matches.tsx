import { useState, useMemo, useEffect } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTournamentMatches,
  useListTournamentGroups,
  useListTournamentTeams,
  useUpdateMatch,
  useStartMatch,
  useDeleteMatch,
  useCreateTournamentMatch,
  useRegenerateTournamentMatches,
  useGetTournamentById,
  useListKnockoutMatches,
  useGenerateKnockoutBracket,
  useGetWildcardPlayoff,
  getGetWildcardPlayoffQueryKey,
  useUpdateKnockoutMatch,
  useStartKnockoutMatch,
  useListTournamentStandings,
  useGetTeamEventState,
  useListLadderState,
  useStartLadder,
  useResetLadder,
  useUpdateLadderGame,
  useUpdateLadderParticipantAttendance,
  useListTournamentCoOrganizers,
  useDeleteKnockoutBracket,
  getListTournamentMatchesQueryKey,
  getListTournamentStandingsQueryKey,
  getGetTeamEventStateQueryKey,
  getGetTournamentByIdQueryKey,
  getListKnockoutMatchesQueryKey,
  getListLadderStateQueryKey,
  getListTournamentCoOrganizersQueryKey,
  getGetBreakoutKnockoutsQueryKey,
  type KnockoutMatch,
  type LadderState,
  type LadderGame,
  type LadderCourt,
} from "@workspace/api-client-react";
import { useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import {
  Check, X, Edit2, RotateCcw, Trash2, Plus, RefreshCw,
  Trophy, Zap, Users, ChevronUp, ChevronDown, AlertCircle,
  Clock, Play, UserCheck, UserX,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { BracketView, type ScoreEdit } from "./BracketView";
import { TeamEventTieDialog } from "./team-event-tie-dialog";
import { useGenerateTeamEventCrossover } from "@workspace/api-client-react";
import { getQualificationStatuses, getPositionFirstQualifierSeeds } from "@/lib/qualification";
import { WildcardPlayoffPanel } from "./WildcardPlayoffPanel";
import { Top6Info, isTop6VirtualBye } from "./Top6Info";
import { BreakoutKnockoutsPanel, isGroupBasedFormat, useBreakoutState } from "./BreakoutKnockouts";

type ViewMode = "round" | "group";

type AddMatchForm = {
  groupId: string;
  homeTeamId: string;
  awayTeamId: string;
  roundNumber: string;
  courtNumber: string;
};

type LadderResultForm = {
  courtNumber: string;
  homePlayerOneId: string;
  homePlayerTwoId: string;
  awayPlayerOneId: string;
  awayPlayerTwoId: string;
  winner: "home" | "away";
  homeScore: string;
  awayScore: string;
};

const ROUND_LABELS: Record<string, string> = {
  r32: "Round of 32",
  r16: "Round of 16",
  quarter: "Quarterfinal",
  semi: "Semifinal",
  third_place: "Third Place Playoff",
  final: "Final",
};
const ROUNDS_ORDER = ["r32", "r16", "quarter", "semi", "final"];

function getDoubleElimLabel(round: string, maxWBRound: number, maxLBRound: number): string {
  if (round === "grand_final") return "Grand Final";
  if (round === "grand_final_reset") return "Grand Final — Reset";
  if (round.startsWith("w")) {
    const n = parseInt(round.slice(1));
    return n === maxWBRound ? "WB Final" : `WB Round ${n}`;
  }
  if (round.startsWith("l")) {
    const n = parseInt(round.slice(1));
    return n === maxLBRound ? "LB Final" : `LB Round ${n}`;
  }
  return round;
}

function nextPow2(n: number): number {
  if (n <= 2) return 2;
  let s = 2;
  while (s < n) s *= 2;
  return Math.min(s, 32);
}

const EMPTY_FORM: AddMatchForm = { groupId: "", homeTeamId: "", awayTeamId: "", roundNumber: "1", courtNumber: "" };
const EMPTY_LADDER_RESULT: LadderResultForm = {
  courtNumber: "1",
  homePlayerOneId: "",
  homePlayerTwoId: "",
  awayPlayerOneId: "",
  awayPlayerTwoId: "",
  winner: "home",
  homeScore: "11",
  awayScore: "7",
};

function LadderStandingsPanel({ ladderState }: { ladderState: LadderState }) {
  const topThree = ladderState.standings.slice(0, 3);
  const ranksFourToSixteen = ladderState.standings.slice(3, 16);
  const ranksSeventeenToThirtyTwo = ladderState.standings.slice(16, 32);

  const rankTable = (title: string, standings: LadderState["standings"]) => (
    <div className="min-w-0 rounded-md border border-border bg-background/30 overflow-hidden">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2">
        <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Rank</th>
              <th className="px-2 py-2 text-left">Seed</th>
              <th className="px-2 py-2 text-left">Player</th>
              <th className="px-2 py-2 text-center">W</th>
              <th className="px-2 py-2 text-center">L</th>
              <th className="px-3 py-2 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((standing) => (
              <tr key={standing.player.id} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2 font-bold mono-font text-primary">#{standing.rank}</td>
                <td className="px-2 py-2 mono-font text-muted-foreground">#{standing.player.seed}</td>
                <td className="max-w-[180px] truncate px-2 py-2 font-medium">{standing.player.name}</td>
                <td className="px-2 py-2 text-center mono-font">{standing.wins}</td>
                <td className="px-2 py-2 text-center mono-font">{standing.losses}</td>
                <td className="px-3 py-2 text-right font-bold mono-font text-primary">{standing.points}</td>
              </tr>
            ))}
            {standings.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-5 text-center text-xs text-muted-foreground">No players in this range yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const podiumCard = (standing: LadderState["standings"][number], className: string) => (
    <div className={`order-1 rounded-md border p-3 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-black mono-font text-primary">#{standing.rank}</span>
        <span className="text-xs font-bold mono-font text-primary">{standing.points} pts</span>
      </div>
      <p className="mt-2 truncate font-bold">{standing.player.name}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        Seed #{standing.player.seed} · {standing.wins}W · {standing.losses}L
      </p>
    </div>
  );

  return (
    <Card className="bg-card border-border overflow-hidden" data-testid="table-ladder-standings">
      <CardContent className="p-0">
        <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-lg font-bold display-font tracking-wide">LADDER STANDINGS</h3>
              <p className="text-xs text-muted-foreground">Ranked by court points, then starting seed.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-wider">
            <Badge variant="outline" className="border-primary/30 text-primary">Court 1 · 6 pts</Badge>
            <Badge variant="outline" className="border-primary/30 text-primary">Court 2 · 4 pts</Badge>
            {ladderState.courtCount === 3 && (
              <Badge variant="outline" className="border-primary/30 text-primary">Court 3 · 2 pts</Badge>
            )}
          </div>
        </div>
        {topThree.length > 0 && (
          <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-3 sm:items-end">
            {topThree[0] && podiumCard(topThree[0], "order-1 sm:order-2 border-primary/60 bg-primary/10")}
            {topThree[1] && podiumCard(topThree[1], "order-2 sm:order-1 border-border bg-background/40")}
            {topThree[2] && podiumCard(topThree[2], "order-3 border-border bg-background/40")}
          </div>
        )}
        <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2">
          {rankTable("Ranks 4–16", ranksFourToSixteen)}
          {rankTable("Ranks 17–32", ranksSeventeenToThirtyTwo)}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Matches() {
  const { id } = useParams<{ id: string }>();
  const tournamentId = Number(id);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();

  const { data: tournament } = useGetTournamentById(tournamentId, { query: { queryKey: getGetTournamentByIdQueryKey(tournamentId) } });
  const { data: matches, isLoading: isLoadingMatches } = useListTournamentMatches(tournamentId);
  const { data: groups, isLoading: isLoadingGroups } = useListTournamentGroups(tournamentId);
  const { data: teams } = useListTournamentTeams(tournamentId);
  const { data: coOrganizers = [] } = useListTournamentCoOrganizers(tournamentId, {
    query: {
      queryKey: getListTournamentCoOrganizersQueryKey(tournamentId),
      enabled: !!user,
    },
  });

  const isGroupKnockout = tournament?.format === "group_knockout";
  const isGroupBased = isGroupBasedFormat(tournament?.format);
  const { data: breakoutState } = useBreakoutState(tournamentId, isGroupBased);
  const breakoutOn = isGroupBased && !!breakoutState?.enabled;
  const legacyKnockout = isGroupKnockout && !breakoutOn;
  const isTop6 = legacyKnockout && (tournament as { knockoutFormat?: string } | undefined)?.knockoutFormat === "top6";
  const isWildcardPlayoff = legacyKnockout && tournament?.wildcardSelectionMethod === "round_robin";
  const breakoutGenerated = !!breakoutState?.brackets.some((b) => b.matches.length > 0);
  // Breakout tournaments (round robin or group→knockout) may also use the three-team qualifier playoff.
  const isBreakoutWildcardPlayoff = breakoutOn && tournament?.wildcardSelectionMethod === "round_robin" && (tournament?.wildcardQualifiers ?? 0) > 0;
  const [breakoutSeedRequest, setBreakoutSeedRequest] = useState(0);
  const { data: wildcardPlayoff } = useGetWildcardPlayoff(tournamentId, {
    query: { enabled: isWildcardPlayoff || isBreakoutWildcardPlayoff, queryKey: getGetWildcardPlayoffQueryKey(tournamentId) },
  });
  const isAmericano = tournament?.format === "americano";
  const isIndividualLadder = tournament?.format === "individual_ladder" || isAmericano;
  const isTeamEvent = tournament?.format === "team_event";
  const { data: teamEventState } = useGetTeamEventState(tournamentId, {
    query: { queryKey: getGetTeamEventStateQueryKey(tournamentId), enabled: isTeamEvent },
  });
  const allGroupMatchesPlayed = !!matches && matches.length > 0 && matches.every((m) => m.played);

  const {
    data: knockoutMatches = [],
    refetch: refetchKnockout,
    isLoading: isLoadingKnockout,
  } = useListKnockoutMatches(tournamentId, {
    query: {
      queryKey: getListKnockoutMatchesQueryKey(tournamentId),
      enabled: isGroupKnockout || isTeamEvent,
    },
  });

  const { data: ladderState } = useListLadderState(tournamentId, {
    query: {
      queryKey: getListLadderStateQueryKey(tournamentId),
      enabled: isIndividualLadder,
    },
  });
  const ladderMinimumPlayers = isAmericano
    ? (ladderState?.courtCount ?? 0) * 4
    : (ladderState?.courtCount === 3 ? 18 : (ladderState?.courtCount ?? 0) * 4);
  const ladderPresentPlayers = ladderState?.participants.filter((player) => player.isHere) ?? [];
  const ladderLatePlayers = ladderState?.participants.filter((player) => !player.isHere) ?? [];
  const ladderCanStart = !!ladderState
    && (isAmericano ? ladderPresentPlayers.length === ladderMinimumPlayers : ladderPresentPlayers.length >= ladderMinimumPlayers)
    && (isAmericano || ladderState.courtCount === 3 || ladderPresentPlayers.length % 2 === 0);

  const knockoutUncertain = isGroupKnockout && isLoadingKnockout;
  const isTournamentOrganizer = !!user && (
    tournament?.createdBy === user.id ||
    coOrganizers.some((organizer) => organizer.userId === user.id)
  );
  const knockoutHasScores = knockoutMatches.some((match) =>
    match.homeScore !== null || match.awayScore !== null,
  );

  const [activeTab, setActiveTab] = useState<"group" | "knockout">("group");
  const [knockoutScore, setKnockoutScore] = useState<ScoreEdit | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("round");
  const [editingScore, setEditingScore] = useState<ScoreEdit | null>(null);
  const [ladderResult, setLadderResult] = useState<LadderResultForm>(EMPTY_LADDER_RESULT);
  const [deletingMatchId, setDeletingMatchId] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddMatchForm>(EMPTY_FORM);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmResetBracket, setConfirmResetBracket] = useState(false);
  const [pendingScores, setPendingScores] = useState<Record<number, { home: string; away: string }>>({});
  const [tieDialogParams, setTieDialogParams] = useState<{ matchId: number, isKnockout: boolean, homeId: number|null, awayId: number|null, homeName: string|null, awayName: string|null } | null>(null);
  const [teamEventSeeds, setTeamEventSeeds] = useState({ a1TeamId: 0, a2TeamId: 0, b1TeamId: 0, b2TeamId: 0 });

  const teamEventGroups = useMemo(() => [...(groups ?? [])].sort((a, b) => a.groupNumber - b.groupNumber), [groups]);
  const teamEventGroupA = useMemo(() => teamEventState?.standings.filter((standing) => standing.groupId === teamEventGroups[0]?.id) ?? [], [teamEventState, teamEventGroups]);
  const teamEventGroupB = useMemo(() => teamEventState?.standings.filter((standing) => standing.groupId === teamEventGroups[1]?.id) ?? [], [teamEventState, teamEventGroups]);
  useEffect(() => {
    if (knockoutMatches.length || teamEventGroupA.length < 2 || teamEventGroupB.length < 2) return;
    setTeamEventSeeds((current) => current.a1TeamId ? current : {
      a1TeamId: teamEventGroupA[0].teamId,
      a2TeamId: teamEventGroupA[1].teamId,
      b1TeamId: teamEventGroupB[0].teamId,
      b2TeamId: teamEventGroupB[1].teamId,
    });
  }, [knockoutMatches.length, teamEventGroupA, teamEventGroupB]);

  // ── Qualifier picker modal ──────────────────────────────────────────────────
  const [showQualifierPicker, setShowQualifierPicker] = useState(false);
  // qualifierCount = how many teams the organiser wants to advance (any number ≥ 2)
  // bracketSize    = next power-of-2 ≥ qualifierCount  (computed, not stored)
  const [qualifierCount, setQualifierCount] = useState<number>(4);
  const [seedSlots, setSeedSlots] = useState<(number | null)[]>([null, null, null, null]);

  // Load standings to pre-suggest qualifiers
  const { data: standings } = useListTournamentStandings(tournamentId, {
    query: {
      queryKey: getListTournamentStandingsQueryKey(tournamentId),
      enabled: isGroupKnockout,
    },
  });

  // bracketSize is always the next power-of-2 ≥ qualifierCount
  const bracketSize = nextPow2(Math.max(qualifierCount, 2));

  // When qualifier count changes, update the count and resize seedSlots to match the new bracket size
  const changeQualifierCount = (count: number) => {
    const maxTeams = (teams ?? []).length;
    const clamped = Math.max(2, Math.min(count, maxTeams));
    const newSize = nextPow2(Math.max(clamped, 2));
    setQualifierCount(clamped);
    setSeedSlots((prev) => {
      if (newSize > prev.length) {
        return [...prev, ...Array(newSize - prev.length).fill(null)];
      } else {
        return prev.slice(0, newSize);
      }
    });
  };

  // Build suggested seeding from standings on modal open
  const autoSuggestedSeeds = useMemo(() => {
    if (!standings || !groups || !teams) return [];
    const perGroup = tournament?.qualifiersPerGroup ?? 1;
    const qualificationStatuses = getQualificationStatuses(
      standings,
      groups.map((group) => group.id),
      perGroup,
      tournament?.wildcardQualifiers ?? 0,
      false,
      tournament?.tiebreakerOrder,
      tournament?.wildcardRankingMethod ?? "points",
      isWildcardPlayoff ? (wildcardPlayoff?.qualifiedTeamIds ?? null) : undefined,
    );
    const groupRows = groups.map((group) => standings.filter((s) => s.groupId === group.id));
    if (isWildcardPlayoff) {
      const automatic: number[] = [];
      for (let position = 0; position < perGroup; position++) {
        for (const rows of groupRows) {
          const row = rows[position];
          if (row && qualificationStatuses.get(row.teamId) === "automatic") automatic.push(row.teamId);
        }
      }
      return [...automatic, ...(wildcardPlayoff?.qualifiedTeamIds ?? [])];
    }
    if (tournament?.wildcardRankingMethod === "ppg") {
      const automatic: number[] = [];
      for (let position = 0; position < perGroup; position++) {
        for (const rows of groupRows) {
          const row = rows[position];
          if (row && qualificationStatuses.get(row.teamId) === "automatic") automatic.push(row.teamId);
        }
      }
      const additional = [...qualificationStatuses].filter(([, status]) => status === "additional").map(([teamId]) => teamId);
      return [...automatic, ...additional];
    }
    if (isTop6) return getPositionFirstQualifierSeeds(groupRows, qualificationStatuses);
    return groupRows.flatMap((rows) => rows.filter((row) => qualificationStatuses.has(row.teamId)).map((row) => row.teamId));
  }, [standings, groups, teams, tournament?.qualifiersPerGroup, tournament?.wildcardQualifiers, tournament?.wildcardRankingMethod, tournament?.tiebreakerOrder, isWildcardPlayoff, wildcardPlayoff?.qualifiedTeamIds, isTop6]);

  const thirdPlaceCandidates = useMemo(
    () => (groups ?? []).map((group) => standings?.filter((row) => row.groupId === group.id)[2]).filter((row): row is NonNullable<typeof row> => row != null),
    [groups, standings],
  );
  const selectedThirdPlaceTeamIds = thirdPlaceCandidates
    .map((candidate) => candidate.teamId)
    .filter((teamId) => knockoutMatches.some((match) => match.homeTeamId === teamId || match.awayTeamId === teamId));
  const expectedPlayoffQualifiers = (groups?.length ?? 0) * (tournament?.qualifiersPerGroup ?? 2) + (tournament?.wildcardQualifiers ?? 0);

  const openQualifierPicker = () => {
    const allTeamIds = (teams ?? []).map((t) => t.id);
    const seeds = autoSuggestedSeeds.length > 0 ? autoSuggestedSeeds : allTeamIds;
    if (isTop6) {
      // Top 6: six ranked qualifier IDs only. The server places the byes for seeds 1 and 2.
      const ranked = autoSuggestedSeeds.slice(0, 6);
      setSeedSlots([...ranked, ...Array(6 - ranked.length).fill(null)]);
      setQualifierCount(6);
      setShowQualifierPicker(true);
      return;
    }
    const count = isWildcardPlayoff ? expectedPlayoffQualifiers : seeds.length;
    const size = nextPow2(Math.max(count, 2));
    const slots: (number | null)[] = Array(size).fill(null);
    seeds.forEach((tid, i) => { if (i < size) slots[i] = tid; });
    setSeedSlots(slots);
    setQualifierCount(count);
    setShowQualifierPicker(true);
  };

  const toggleThirdPlaceCandidate = (teamId: number) => {
    setSeedSlots((previous) => {
      const next = [...previous];
      const existing = next.indexOf(teamId);
      if (existing >= 0) {
        next[existing] = null;
      } else {
        const wildcardStart = (groups?.length ?? 0) * (tournament?.qualifiersPerGroup ?? 2);
        const empty = [wildcardStart, wildcardStart + 1].find((index) => next[index] == null);
        if (empty !== undefined) next[empty] = teamId;
      }
      return next;
    });
  };

  // Slot manipulation helpers
  const setSlot = (idx: number, value: number | null) => {
    setSeedSlots((prev) => { const n = [...prev]; n[idx] = value; return n; });
  };

  const swapSlots = (a: number, b: number) => {
    setSeedSlots((prev) => { const n = [...prev]; [n[a], n[b]] = [n[b], n[a]]; return n; });
  };

  // Derived: which team IDs are used more than once (errors)
  const usedTeamIds = seedSlots.filter((x): x is number => x !== null);
  const duplicates = new Set(usedTeamIds.filter((id, i) => usedTeamIds.indexOf(id) !== i));

  const teamCount = usedTeamIds.length;
  const byeCount = bracketSize - teamCount;
  const top6Valid = seedSlots.length === 6 && teamCount === 6 && duplicates.size === 0;
  const isValid = isTop6 ? top6Valid : teamCount >= 2 && duplicates.size === 0 && (!isWildcardPlayoff ||
    (teamCount === expectedPlayoffQualifiers &&
      autoSuggestedSeeds.slice(0, (groups?.length ?? 0) * (tournament?.qualifiersPerGroup ?? 2)).every((id) => usedTeamIds.includes(id)) &&
      usedTeamIds.filter((id) => thirdPlaceCandidates.some((candidate) => candidate.teamId === id)).length === 2));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListTournamentMatchesQueryKey(tournamentId) });
    queryClient.invalidateQueries({ queryKey: getListTournamentStandingsQueryKey(tournamentId) });
  };

  const invalidateLadder = () => {
    queryClient.invalidateQueries({ queryKey: getListLadderStateQueryKey(tournamentId) });
  };

  const updateMatch = useUpdateMatch({
    mutation: {
      onSuccess: () => { invalidate(); setEditingScore(null); toast({ title: "Score saved" }); },
      onError: () => toast({ title: "Error", description: "Failed to update match.", variant: "destructive" }),
    },
  });

  const startMatch = useStartMatch({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Match started", description: "Spectators can now see it in Now Playing." }); },
      onError: () => toast({ title: "Error", description: "Failed to start match.", variant: "destructive" }),
    },
  });

  const deleteMatch = useDeleteMatch({
    mutation: {
      onSuccess: () => { invalidate(); setDeletingMatchId(null); },
      onError: () => toast({ title: "Error", description: "Failed to delete match.", variant: "destructive" }),
    },
  });

  const restoreDeletedMatch = useCreateTournamentMatch({
    mutation: {
      onError: () => toast({ title: "Undo failed", description: "The deleted match could not be restored.", variant: "destructive" }),
    },
  });

  const createMatch = useCreateTournamentMatch({
    mutation: {
      onSuccess: () => {
        invalidate();
        setShowAddForm(false);
        setAddForm(EMPTY_FORM);
        toast({ title: "Fixture added" });
      },
      onError: () => toast({ title: "Error", description: "Failed to add fixture.", variant: "destructive" }),
    },
  });

  const regenerateMatches = useRegenerateTournamentMatches({
    mutation: {
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getGetWildcardPlayoffQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getGetBreakoutKnockoutsQueryKey(tournamentId) });
        setConfirmRegenerate(false);
        toast({ title: "Fixtures regenerated", description: "All matches have been rescheduled." });
      },
      onError: () => toast({ title: "Error", description: "Failed to regenerate fixtures.", variant: "destructive" }),
    },
  });

  const generateTeamCrossover = useGenerateTeamEventCrossover({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getGetTournamentByIdQueryKey(tournamentId) });
        toast({ title: "Crossover Semifinals Generated" });
      },
      onError: (e: any) => toast({ title: "Error", description: e?.message || "Failed to generate crossover.", variant: "destructive" })
    }
  });

  const generateKnockout = useGenerateKnockoutBracket({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getListKnockoutMatchesQueryKey(tournamentId), data);
        setShowQualifierPicker(false);
        setActiveTab("knockout");
        toast({ title: "Knockout bracket generated!", description: "Enter scores for each match to advance teams." });
      },
      onError: (err: { message?: string }) => {
        toast({ title: "Error", description: err?.message ?? "Failed to generate knockout bracket", variant: "destructive" });
      },
    },
  });

  const resetKnockoutBracket = useDeleteKnockoutBracket({
    mutation: {
      onSuccess: () => {
        queryClient.setQueryData(getListKnockoutMatchesQueryKey(tournamentId), []);
        queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
        setConfirmResetBracket(false);
        openQualifierPicker();
        toast({ title: "Bracket reset", description: "Set the new knockout seeding to generate a bracket." });
      },
      onError: (err: { message?: string }) => {
        toast({ title: "Error", description: err?.message ?? "Failed to reset knockout bracket", variant: "destructive" });
      },
    },
  });

  const handleGenerateBracket = () => {
    if (!isValid) return;
    generateKnockout.mutate({ id: tournamentId, data: { seeds: isTop6 ? seedSlots.slice(0, 6) : seedSlots } });
  };

  const handleResetBracket = () => {
    resetKnockoutBracket.mutate({ id: tournamentId });
  };

  const updateKnockoutMatch = useUpdateKnockoutMatch({
    mutation: {
      onSuccess: (updated) => {
        queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getGetTournamentByIdQueryKey(tournamentId) });
        setKnockoutScore(null);
        toast({
          title: "Score saved",
          description: (updated as KnockoutMatch).winnerName ? `${(updated as KnockoutMatch).winnerName} advances!` : "Score recorded.",
        });
      },
      onError: (err: { message?: string }) => {
        toast({ title: "Error", description: err?.message ?? "Failed to save score", variant: "destructive" });
      },
    },
  });

  const startKnockoutMatch = useStartKnockoutMatch({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
        toast({ title: "Match started", description: "Spectators can now see it in Now Playing." });
      },
      onError: () => toast({ title: "Error", description: "Failed to start knockout match.", variant: "destructive" }),
    },
  });

  const startLadder = useStartLadder({
    mutation: {
      onSuccess: () => { invalidateLadder(); toast({ title: "Ladder started" }); },
      onError: (error: any) => toast({ title: "Error", description: error?.response?.data?.error ?? "Failed to start ladder.", variant: "destructive" }),
    },
  });

  const resetLadder = useResetLadder({
    mutation: {
      onSuccess: () => { invalidateLadder(); toast({ title: "Ladder reset" }); },
      onError: () => toast({ title: "Error", description: "Failed to reset ladder.", variant: "destructive" }),
    },
  });

  const updateLadderGame = useUpdateLadderGame({
    mutation: {
      onSuccess: () => {
        invalidateLadder();
        setLadderResult((current) => ({ ...EMPTY_LADDER_RESULT, courtNumber: current.courtNumber }));
        toast({ title: "Result submitted", description: isAmericano ? "Standings and the next partner rotation have been updated." : "Standings, court movement, and the spectator view have been updated." });
      },
      onError: (error: any) => toast({ title: "Error", description: error?.response?.data?.error ?? "Failed to save score.", variant: "destructive" }),
    },
  });

  const updateLadderAttendance = useUpdateLadderParticipantAttendance({
    mutation: {
      onSuccess: (_state, variables) => {
        invalidateLadder();
        toast({
          title: variables.data.isHere ? "Player marked arrived" : "Player marked not here",
          description: variables.data.isHere && ladderState?.started ? "They have joined Bench 2." : undefined,
        });
      },
      onError: (error: any) => toast({ title: "Attendance update failed", description: error?.response?.data?.error ?? "Please try again.", variant: "destructive" }),
    },
  });

  const handleSubmitLadderResult = () => {
    if (!ladderState) return;
    const courtNumber = Number(ladderResult.courtNumber);
    const game = ladderState.courts.find((court) => court.courtNumber === courtNumber)?.activeGame;
    if (!game || game.played) {
      toast({ title: "Court unavailable", description: "Choose a court with an active unscored match.", variant: "destructive" });
      return;
    }

    const playerIds = [
      Number(ladderResult.homePlayerOneId),
      Number(ladderResult.homePlayerTwoId),
      Number(ladderResult.awayPlayerOneId),
      Number(ladderResult.awayPlayerTwoId),
    ];
    const homeScore = Number(ladderResult.homeScore);
    const awayScore = Number(ladderResult.awayScore);
    if (playerIds.some((id) => !Number.isInteger(id) || id < 1)) {
      toast({ title: "Select all four players", variant: "destructive" });
      return;
    }
    if (new Set(playerIds).size !== 4) {
      toast({ title: "Duplicate player", description: "Each player can only appear once in a match.", variant: "destructive" });
      return;
    }
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0 || (!isAmericano && homeScore === awayScore)) {
      toast({ title: "Invalid score", description: isAmericano ? "Enter non-negative point totals." : "Enter non-negative scores with one clear winner.", variant: "destructive" });
      return;
    }
    const scoreWinner = homeScore > awayScore ? "home" : "away";
    if (!isAmericano && scoreWinner !== ladderResult.winner) {
      toast({ title: "Winner and score do not match", description: `The score shows Team ${scoreWinner === "home" ? "A" : "B"} as the winner.`, variant: "destructive" });
      return;
    }

    updateLadderGame.mutate({
      id: game.id,
      data: {
        homePlayerOneId: playerIds[0],
        homePlayerTwoId: playerIds[1],
        awayPlayerOneId: playerIds[2],
        awayPlayerTwoId: playerIds[3],
        homeScore,
        awayScore,
      },
    });
  };

  const handleLadderCourtChange = (courtNumber: string) => {
    const game = ladderState?.courts.find((court) => String(court.courtNumber) === courtNumber)?.activeGame;
    setLadderResult({
      ...EMPTY_LADDER_RESULT,
      courtNumber,
      homePlayerOneId: game ? String(game.homeTeam.players[0]?.id ?? "") : "",
      homePlayerTwoId: game ? String(game.homeTeam.players[1]?.id ?? "") : "",
      awayPlayerOneId: game ? String(game.awayTeam.players[0]?.id ?? "") : "",
      awayPlayerTwoId: game ? String(game.awayTeam.players[1]?.id ?? "") : "",
    });
  };

  const handleSaveScore = (matchId: number) => {
    if (!editingScore) return;
    const home = parseInt(editingScore.homeScore, 10);
    const away = parseInt(editingScore.awayScore, 10);
    if (isNaN(home) || isNaN(away) || home < 0 || away < 0) {
      toast({ title: "Invalid score", description: "Enter valid non-negative numbers.", variant: "destructive" });
      return;
    }
    updateMatch.mutate({ id: matchId, data: { homeScore: home, awayScore: away, played: true } });
  };

  const handleResetMatch = (matchId: number) => {
    updateMatch.mutate({ id: matchId, data: { homeScore: null, awayScore: null, played: false } });
  };

  const handleStartMatch = (matchId: number) => {
    startMatch.mutate({ id: matchId });
  };

  const handleStartKnockoutMatch = (matchId: number) => {
    startKnockoutMatch.mutate({ id: matchId });
  };

  const handleSaveUnplayed = (matchId: number) => {
    const p = pendingScores[matchId];
    const home = parseInt(p?.home ?? "", 10);
    const away = parseInt(p?.away ?? "", 10);
    if (isNaN(home) || isNaN(away) || home < 0 || away < 0) {
      toast({ title: "Enter valid scores", description: "Both scores must be 0 or higher.", variant: "destructive" });
      return;
    }
    updateMatch.mutate({ id: matchId, data: { homeScore: home, awayScore: away, played: true } });
    setPendingScores(prev => { const n = { ...prev }; delete n[matchId]; return n; });
  };

  const handleAddMatch = () => {
    const gid = parseInt(addForm.groupId, 10);
    const home = parseInt(addForm.homeTeamId, 10);
    const away = parseInt(addForm.awayTeamId, 10);
    const round = parseInt(addForm.roundNumber, 10);
    if (isNaN(gid) || isNaN(home) || isNaN(away) || isNaN(round) || round < 1) {
      toast({ title: "Invalid input", description: "Fill in all required fields.", variant: "destructive" });
      return;
    }
    if (home === away) {
      toast({ title: "Invalid fixture", description: "Home and away teams must be different.", variant: "destructive" });
      return;
    }
    const courtNumber = addForm.courtNumber ? parseInt(addForm.courtNumber, 10) : undefined;
    createMatch.mutate({ id: tournamentId, data: { groupId: gid, homeTeamId: home, awayTeamId: away, roundNumber: round, courtNumber } });
  };

  const handleDeleteMatch = (match: NonNullable<typeof matches>[number]) => {
    deleteMatch.mutate(
      { id: match.id },
      {
        onSuccess: () => {
          toast({
            title: "Match removed",
            description: `${match.homeTeamName ?? "Home team"} vs ${match.awayTeamName ?? "Away team"}`,
            action: (
              <ToastAction
                altText="Undo match deletion"
                onClick={() => {
                  restoreDeletedMatch.mutate(
                    {
                      id: tournamentId,
                      data: {
                        groupId: match.groupId,
                        homeTeamId: match.homeTeamId,
                        awayTeamId: match.awayTeamId,
                        roundNumber: match.roundNumber,
                        courtNumber: match.courtNumber ?? undefined,
                      },
                    },
                    {
                      onSuccess: (restored) => {
                        if (match.played && match.homeScore != null && match.awayScore != null) {
                          updateMatch.mutate({
                            id: restored.id,
                            data: { homeScore: match.homeScore, awayScore: match.awayScore, played: true },
                          });
                        } else {
                          invalidate();
                          toast({ title: "Match restored" });
                        }
                      },
                    },
                  );
                }}
              >
                Undo
              </ToastAction>
            ),
          });
        },
      },
    );
  };

  const handleSaveKnockoutScore = (matchId: number) => {
    if (!knockoutScore || knockoutScore.matchId !== matchId) return;
    const home = parseInt(knockoutScore.homeScore, 10);
    const away = parseInt(knockoutScore.awayScore, 10);
    if (isNaN(home) || isNaN(away) || home < 0 || away < 0) {
      toast({ title: "Invalid score", description: "Enter valid non-negative numbers.", variant: "destructive" });
      return;
    }
    if (home === away) {
      toast({ title: "No draws in knockout", description: "One team must score more to advance.", variant: "destructive" });
      return;
    }
    updateKnockoutMatch.mutate({ id: matchId, data: { homeScore: home, awayScore: away } });
  };

  // ── Derived data ────────────────────────────────────────
  const isLoading = isLoadingMatches || isLoadingGroups;
  const allRounds = [...new Set(matches?.map(m => m.roundNumber) ?? [])].sort((a, b) => a - b);

  const teamGameCount = new Map<number, { total: number; played: number }>();
  for (const m of matches ?? []) {
    const home = teamGameCount.get(m.homeTeamId) ?? { total: 0, played: 0 };
    teamGameCount.set(m.homeTeamId, { total: home.total + 1, played: home.played + (m.played ? 1 : 0) });
    const away = teamGameCount.get(m.awayTeamId) ?? { total: 0, played: 0 };
    teamGameCount.set(m.awayTeamId, { total: away.total + 1, played: away.played + (m.played ? 1 : 0) });
  }

  let filteredMatches = matches ?? [];
  if (viewMode === "group" && selectedGroup !== null) filteredMatches = filteredMatches.filter(m => m.groupId === selectedGroup);
  if (viewMode === "round" && selectedRound !== null) filteredMatches = filteredMatches.filter(m => m.roundNumber === selectedRound);

  const groupedMatches: { label: string; matches: typeof filteredMatches }[] = [];
  if (viewMode === "round") {
    const rounds = [...new Set(filteredMatches.map(m => m.roundNumber))].sort((a, b) => a - b);
    for (const r of rounds) groupedMatches.push({ label: `Round ${r}`, matches: filteredMatches.filter(m => m.roundNumber === r) });
  } else {
    const groupIds = [...new Set(filteredMatches.map(m => m.groupId))];
    for (const gid of groupIds) {
      const g = groups?.find(gr => gr.id === gid);
      groupedMatches.push({ label: g?.name ?? `Group ${gid}`, matches: filteredMatches.filter(m => m.groupId === gid) });
    }
  }

  const formGroupTeams = addForm.groupId
    ? (teams ?? []).filter(t => t.groupId === parseInt(addForm.groupId, 10))
    : [];

  const isDoubleElim = knockoutMatches.some(m => (m as KnockoutMatch & { bracket?: string }).bracket === "winner");
  const knockoutByRound: { round: string; label: string; matches: KnockoutMatch[] }[] = [];
  for (const round of ROUNDS_ORDER) {
    const roundMatches = knockoutMatches.filter(m => m.round === round);
    if (roundMatches.length > 0) {
      const visible = isTop6 ? roundMatches.filter((m) => !isTop6VirtualBye(m, "quarter")) : roundMatches;
      knockoutByRound.push({ round, label: ROUND_LABELS[round] ?? round, matches: [...visible].sort((a, b) => a.matchNumber - b.matchNumber) });
    }
  }

  const wbRoundKeys = [...new Set(knockoutMatches.filter(m => (m as any).bracket === "winner").map(m => m.round))].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  const lbRoundKeys = [...new Set(knockoutMatches.filter(m => (m as any).bracket === "loser").map(m => m.round))].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  const maxWBRound = wbRoundKeys.length ? Math.max(...wbRoundKeys.map(r => parseInt(r.slice(1)))) : 0;
  const maxLBRound = lbRoundKeys.length ? Math.max(...lbRoundKeys.map(r => parseInt(r.slice(1)))) : 0;

  const wbSections = wbRoundKeys.map(r => ({
    round: r, label: getDoubleElimLabel(r, maxWBRound, maxLBRound),
    matches: knockoutMatches.filter(m => m.round === r).sort((a, b) => a.matchNumber - b.matchNumber),
  }));
  const lbSections = lbRoundKeys.map(r => ({
    round: r, label: getDoubleElimLabel(r, maxWBRound, maxLBRound),
    matches: knockoutMatches.filter(m => m.round === r).sort((a, b) => a.matchNumber - b.matchNumber),
  }));
  const gfMatches = knockoutMatches.filter(m => m.round === "grand_final" || m.round === "grand_final_reset").sort((a, b) => a.matchNumber - b.matchNumber);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64 bg-card" />
        <div className="space-y-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 bg-card" />)}
        </div>
      </div>
    );
  }

  // ── Team lookup for the qualifier picker ────────────────
  const teamById = Object.fromEntries((teams ?? []).map(t => [t.id, t]));

  return (
    <div className="space-y-6">

      {/* ══════════════════════════════════════════════════════════
          INDIVIDUAL LADDER VIEW
          ══════════════════════════════════════════════════════════ */}
      {isIndividualLadder && ladderState && (
        <div className="space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 sm:p-6 rounded-lg border border-border shadow-sm">
            <div>
               <h2 className="text-2xl sm:text-3xl font-bold display-font text-foreground tracking-wide uppercase">{isAmericano ? "AMERICANO SOCIAL" : "LADDER CONTROL"}</h2>
              <p className="text-muted-foreground text-sm">
                 Batch {ladderState.batchNumber}. Courts: {ladderState.courtCount}. Here: {ladderPresentPlayers.length}. Late: {ladderLatePlayers.length}.
              </p>
            </div>
            <div className="flex gap-2">
              {!ladderState.started ? (
                <Button onClick={() => startLadder.mutate({ id: tournamentId })} disabled={startLadder.isPending || !ladderCanStart} className="font-bold uppercase tracking-wider" data-testid="button-start-ladder">
                  <Zap className="w-4 h-4 mr-2" /> Start Ladder
                </Button>
              ) : (
                <Button onClick={() => resetLadder.mutate({ id: tournamentId })} disabled={resetLadder.isPending} variant="outline" className="text-destructive border-destructive hover:bg-destructive/10 font-bold uppercase tracking-wider" data-testid="button-reset-ladder">
                  <RotateCcw className="w-4 h-4 mr-2" /> Reset Ladder
                </Button>
              )}
            </div>
          </div>

          {(!ladderState.started || (!isAmericano && ladderLatePlayers.length > 0)) && (
            <Card className="border-amber-500/30 bg-card">
              <CardContent className="p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-xl font-black display-font uppercase tracking-wide">Player Check-in</h3>
                    <p className="text-sm text-muted-foreground">
                      {isAmericano ? "Choose exactly four available players per court. Partners rotate automatically each round." : "Before starting, mark late players as not here. After starting, arriving players join Bench 2."}
                    </p>
                  </div>
                  {!ladderState.started && (
                    <Badge variant="outline" className="w-fit border-amber-500/40 text-amber-400">
                      {ladderPresentPlayers.length} ready · minimum {ladderMinimumPlayers}
                    </Badge>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(ladderState.started ? ladderLatePlayers : ladderState.participants).map((player) => (
                    <div key={player.id} className={`flex items-center justify-between gap-3 rounded-md border p-3 ${player.isHere ? "border-border bg-background/40" : "border-amber-500/40 bg-amber-500/5"}`}>
                      <div className="min-w-0">
                        <div className="truncate font-bold">#{player.seed} {player.name}</div>
                        <div className={`text-xs font-semibold uppercase tracking-wider ${player.isHere ? "text-green-400" : "text-amber-400"}`}>
                          {player.isHere ? "Here" : "Not here yet"}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={player.isHere ? "outline" : "default"}
                        disabled={updateLadderAttendance.isPending}
                        onClick={() => updateLadderAttendance.mutate({
                          id: tournamentId,
                          participantId: player.id,
                          data: { isHere: !player.isHere },
                        })}
                        data-testid={`button-ladder-attendance-${player.id}`}
                      >
                        {player.isHere ? <UserX className="mr-1.5 h-4 w-4" /> : <UserCheck className="mr-1.5 h-4 w-4" />}
                        {player.isHere ? "Not here" : "Arrived"}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <LadderStandingsPanel ladderState={ladderState} />

          {ladderState.started && (
            <Card className="overflow-hidden border-primary/30 bg-card shadow-lg">
              <div className="flex flex-col gap-1 border-b border-primary/20 bg-primary/10 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-2xl font-black display-font uppercase tracking-wide">Admin Match Entry</h3>
                   <p className="text-sm text-muted-foreground">{isAmericano ? "Enter each team's points. Every point is added to both partners' individual total." : "Choose the court and four players, then submit the final result."}</p>
                </div>
                <Badge variant="outline" className="w-fit border-primary/40 text-primary">
                  Match #{String(ladderState.courts.find((court) => court.courtNumber === Number(ladderResult.courtNumber))?.activeGame?.id ?? 0).padStart(2, "0")}
                </Badge>
              </div>

              <CardContent className="grid gap-6 p-5 lg:grid-cols-[220px_1fr_1fr]">
                <div className="space-y-2">
                  <label htmlFor="ladder-court" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Court</label>
                  <select
                    id="ladder-court"
                    value={ladderResult.courtNumber}
                    onChange={(event) => handleLadderCourtChange(event.target.value)}
                    className="h-11 w-full rounded-md border border-border bg-background px-3 font-bold text-foreground"
                    data-testid="select-ladder-court"
                  >
                    {ladderState.courts.map((court) => (
                      <option key={court.courtNumber} value={court.courtNumber}>
                        Court {court.courtNumber} — {Math.max(8 - court.courtNumber * 2, 0)} pts
                      </option>
                    ))}
                  </select>
                   <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
                     {isAmericano ? "The suggested lineup is filled in automatically. You can manually change any player before submitting; previously used partnerships are blocked where possible." : "Court results feed the five-zone ladder automatically. Points are awarded from the selected court."}
                   </div>
                </div>

                {(["home", "away"] as const).map((team) => (
                  <div key={team} className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
                    <h4 className="font-black uppercase tracking-widest text-primary">Team {team === "home" ? "A" : "B"}</h4>
                    {([team === "home" ? "homePlayerOneId" : "awayPlayerOneId", team === "home" ? "homePlayerTwoId" : "awayPlayerTwoId"] as const).map((field, index) => (
                      <select
                        key={field}
                        value={ladderResult[field]}
                        onChange={(event) => setLadderResult((current) => ({ ...current, [field]: event.target.value }))}
                        className="h-11 w-full rounded-md border border-border bg-card px-3 text-foreground"
                        data-testid={`select-ladder-${field}`}
                      >
                        <option value="">Select player {index + 1}</option>
                        {ladderState.participants.filter((player) => !isAmericano || player.isHere).map((player) => {
                          const selectedElsewhere = [
                            ladderResult.homePlayerOneId,
                            ladderResult.homePlayerTwoId,
                            ladderResult.awayPlayerOneId,
                            ladderResult.awayPlayerTwoId,
                          ].some((id) => id === String(player.id) && ladderResult[field] !== String(player.id));
                          return (
                            <option key={player.id} value={player.id} disabled={selectedElsewhere}>
                              #{player.seed} {player.name}
                            </option>
                          );
                        })}
                      </select>
                    ))}
                  </div>
                ))}

                {!isAmericano && <div className="space-y-2 lg:col-start-2">
                  <label htmlFor="ladder-winner" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Winner</label>
                  <select
                    id="ladder-winner"
                    value={ladderResult.winner}
                    onChange={(event) => setLadderResult((current) => ({ ...current, winner: event.target.value as "home" | "away" }))}
                    className="h-11 w-full rounded-md border border-border bg-background px-3 font-bold text-foreground"
                    data-testid="select-ladder-winner"
                  >
                    <option value="home">Team A</option>
                    <option value="away">Team B</option>
                  </select>
                </div>}

                <div className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Score</span>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min={0}
                      value={ladderResult.homeScore}
                      onChange={(event) => setLadderResult((current) => ({ ...current, homeScore: event.target.value }))}
                      className="h-11 text-center text-xl font-black mono-font"
                      aria-label="Team A score"
                      data-testid="input-ladder-team-a-score"
                    />
                    <span className="font-black text-muted-foreground">–</span>
                    <Input
                      type="number"
                      min={0}
                      value={ladderResult.awayScore}
                      onChange={(event) => setLadderResult((current) => ({ ...current, awayScore: event.target.value }))}
                      className="h-11 text-center text-xl font-black mono-font"
                      aria-label="Team B score"
                      data-testid="input-ladder-team-b-score"
                    />
                  </div>
                </div>

                <Button
                  onClick={handleSubmitLadderResult}
                  disabled={updateLadderGame.isPending}
                  className="h-12 font-black uppercase tracking-widest lg:col-span-3"
                  data-testid="button-submit-ladder-result"
                >
                  {updateLadderGame.isPending ? "Submitting…" : "Submit Result"}
                </Button>
              </CardContent>
            </Card>
          )}

          {ladderState.history.length > 0 && (
            <div className="space-y-4 pt-8">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-muted-foreground" />
                <h3 className="text-xl font-bold display-font tracking-wide">GAME HISTORY</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...ladderState.history].reverse().map(game => (
                  <div key={game.id} className="bg-card border border-border rounded-lg p-3 text-sm flex flex-col gap-2 opacity-80 hover:opacity-100 transition-opacity">
                    <div className="flex justify-between items-center text-xs text-muted-foreground mb-1">
                      <span className="mono-font uppercase tracking-widest">Court {game.courtNumber}</span>
                      <span className="uppercase">Batch {game.batchNumber}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex flex-col">
                        <span className="truncate max-w-[120px]">#{game.homeTeam.players[0].seed} {game.homeTeam.players[0].name}</span>
                        <span className="truncate max-w-[120px]">#{game.homeTeam.players[1].seed} {game.homeTeam.players[1].name}</span>
                      </div>
                      <span className={`text-base font-bold mono-font ${game.homeScore! > game.awayScore! ? 'text-primary' : ''}`}>{game.homeScore}</span>
                    </div>
                    <div className="h-px bg-border/50" />
                    <div className="flex justify-between items-center">
                      <div className="flex flex-col">
                        <span className="truncate max-w-[120px]">#{game.awayTeam.players[0].seed} {game.awayTeam.players[0].name}</span>
                        <span className="truncate max-w-[120px]">#{game.awayTeam.players[1].seed} {game.awayTeam.players[1].name}</span>
                      </div>
                      <span className={`text-base font-bold mono-font ${game.awayScore! > game.homeScore! ? 'text-primary' : ''}`}>{game.awayScore}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          QUALIFIER PICKER MODAL
          ══════════════════════════════════════════════════════════ */}
      {showQualifierPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

            {/* Modal header */}
            <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-border">
              <div>
                <h2 className="text-lg font-bold display-font tracking-wide text-foreground">Bracket Seeding</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isTop6 ? "Top 6 Playoff: rank exactly six qualifiers. Seeds 1 and 2 receive byes into the semifinals automatically." : isWildcardPlayoff ? "Choose two of the three third-place teams for the last two places. You can reorder bracket slots below." : <>Assign teams to bracket slots. Leave a slot as <span className="text-yellow-400 font-semibold">BYE</span> to auto-advance the opponent. Use ↑↓ to reorder.</>}
                </p>
              </div>
              <Button size="icon" variant="ghost" className="shrink-0 mt-0.5" onClick={() => setShowQualifierPicker(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {isTop6 && (
              <div className="border-b border-border px-5 py-3"><Top6Info /></div>
            )}
            {/* Qualifier count input */}
            {!isTop6 && <div className="px-5 py-3 border-b border-border flex items-center gap-3 flex-wrap">
              <span className="text-xs text-muted-foreground uppercase tracking-wider shrink-0">Teams advancing:</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => changeQualifierCount(qualifierCount - 1)}
                  disabled={isWildcardPlayoff || qualifierCount <= 2}
                  className="h-8 w-7 rounded border border-border bg-background text-sm font-bold text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                >−</button>
                <input
                  type="number"
                  min={2}
                  max={(teams ?? []).length || 32}
                  value={qualifierCount}
                  disabled={isWildcardPlayoff}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) changeQualifierCount(v);
                  }}
                  className="w-16 h-8 rounded border border-border bg-card text-foreground text-sm px-2 mono-font text-center"
                />
                <button
                  onClick={() => changeQualifierCount(qualifierCount + 1)}
                  disabled={isWildcardPlayoff || qualifierCount >= ((teams ?? []).length || 32)}
                  className="h-8 w-7 rounded border border-border bg-background text-sm font-bold text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                >+</button>
              </div>
              <span className="text-xs text-muted-foreground">
                → {bracketSize}-slot bracket
                {bracketSize > qualifierCount && (
                  <span className="text-yellow-400 ml-1">({bracketSize - qualifierCount} bye{bracketSize - qualifierCount !== 1 ? "s" : ""} added)</span>
                )}
              </span>
              <div className="text-xs text-muted-foreground ml-auto">
                <span className="text-foreground font-semibold">{teamCount}</span> assigned
                {byeCount > 0 && (
                  <span className="text-yellow-400 ml-1.5 font-semibold">· {byeCount} bye{byeCount !== 1 ? "s" : ""}</span>
                )}
              </div>
            </div>}

            {isWildcardPlayoff && (
              <div className="border-b border-border px-5 py-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">Last two places · choose two third-place teams</p>
                <div className="flex flex-wrap gap-2">
                  {thirdPlaceCandidates.map((candidate) => {
                    const selected = usedTeamIds.includes(candidate.teamId);
                    const count = thirdPlaceCandidates.filter((row) => usedTeamIds.includes(row.teamId)).length;
                    return (
                      <label key={candidate.teamId} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${selected ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}>
                        <input type="checkbox" checked={selected} disabled={!selected && count >= 2} onChange={() => toggleThirdPlaceCandidate(candidate.teamId)} className="accent-primary" />
                        {candidate.teamName}
                      </label>
                    );
                  })}
                </div>
                {thirdPlaceCandidates.length !== 3 && <p className="mt-2 text-xs text-amber-400">Each group needs a third-place team before you can pick the last two places.</p>}
                {!allGroupMatchesPlayed && <p className="mt-2 text-xs text-amber-400">Group results are not final yet. These positions may change.</p>}
                <p className="mt-2 text-xs text-muted-foreground">Manual picks override the playoff result when you generate the bracket. They do not change group scores.</p>
              </div>
            )}

            {/* Seed slots */}
            <div className="overflow-y-auto flex-1 px-5 py-3">
              {isTop6 ? (
                <ol className="space-y-1.5" data-testid="list-top6-seeds">
                  {seedSlots.slice(0, 6).map((val, idx) => {
                    const isDuplicate = val !== null && duplicates.has(val);
                    const pool = autoSuggestedSeeds.length > 0 ? autoSuggestedSeeds : (teams ?? []).map((t) => t.id);
                    return (
                      <li key={idx} className={`grid grid-cols-[2.5rem_1fr_auto_auto] items-center gap-2 rounded-md border px-2 py-1.5 ${isDuplicate ? "border-destructive/60 bg-destructive/5" : val === null ? "border-yellow-500/30 bg-yellow-500/5" : "border-border bg-background"}`}>
                        <span className="text-xs font-bold mono-font text-primary text-center">#{idx + 1}</span>
                        <select
                          value={val ?? ""}
                          onChange={(e) => setSlot(idx, e.target.value === "" ? null : parseInt(e.target.value, 10))}
                          className={`w-full h-8 rounded border text-sm px-2 bg-card text-foreground ${isDuplicate ? "border-destructive" : "border-border"}`}
                          data-testid={`select-top6-seed-${idx + 1}`}
                        >
                          <option value="" disabled>Choose a qualifier</option>
                          {pool.map((tid) => <option key={tid} value={tid}>{teamById[tid]?.name ?? `#${tid}`}</option>)}
                        </select>
                        <span className={`text-[10px] uppercase tracking-wider ${idx < 2 ? "text-yellow-400" : "text-muted-foreground"}`}>
                          {idx < 2 ? "Bye to SF" : idx === 2 ? "QF v #6" : idx === 3 ? "QF v #5" : idx === 4 ? "QF v #4" : "QF v #3"}
                        </span>
                        <div className="flex flex-col gap-0.5">
                          <button onClick={() => { if (idx > 0) swapSlots(idx, idx - 1); }} disabled={idx === 0} aria-label="Move up" data-testid={`button-top6-up-${idx + 1}`} className="h-3.5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20"><ChevronUp className="h-3 w-3" /></button>
                          <button onClick={() => { if (idx < 5) swapSlots(idx, idx + 1); }} disabled={idx === 5} aria-label="Move down" data-testid={`button-top6-down-${idx + 1}`} className="h-3.5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20"><ChevronDown className="h-3 w-3" /></button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
              <div className="space-y-1.5">
                {/* Column headers */}
                <div className="grid grid-cols-[2rem_1fr_auto_auto] gap-2 px-1 mb-2">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider text-center">#</span>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Team / BYE</span>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider text-center">vs</span>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider w-12 text-center">Move</span>
                </div>

                {/* Render pairs side-by-side */}
                {Array.from({ length: bracketSize / 2 }, (_, pairIdx) => {
                  const i = pairIdx * 2;
                  const j = i + 1;
                  const slotA = seedSlots[i] ?? null;
                  const slotB = seedSlots[j] ?? null;

                  const renderSlot = (idx: number, val: number | null) => {
                    const isDuplicate = val !== null && duplicates.has(val);
                    return (
                      <div
                        key={idx}
                        className={`grid grid-cols-[2rem_1fr_auto] gap-2 items-center px-2 py-1.5 rounded-md border transition-colors ${
                          isDuplicate ? "border-destructive/60 bg-destructive/5" : val === null ? "border-yellow-500/30 bg-yellow-500/5" : "border-border bg-background"
                        }`}
                      >
                        {/* Seed number */}
                        <span className={`text-xs font-bold mono-font text-center ${val === null ? "text-yellow-400/60" : "text-muted-foreground"}`}>
                          {idx + 1}
                        </span>

                        {/* Team dropdown */}
                        <select
                          value={val ?? "bye"}
                          onChange={(e) => setSlot(idx, e.target.value === "bye" ? null : parseInt(e.target.value, 10))}
                          className={`w-full h-8 rounded border text-sm px-2 bg-card text-foreground transition-colors ${
                            isDuplicate ? "border-destructive" : val === null ? "border-yellow-500/50 text-yellow-400 italic" : "border-border"
                          }`}
                        >
                          <option value="bye">— BYE (auto-advance) —</option>
                          <optgroup label="Teams">
                             {(teams ?? []).filter((team) => !isWildcardPlayoff ||
                               autoSuggestedSeeds.slice(0, (groups?.length ?? 0) * (tournament?.qualifiersPerGroup ?? 2)).includes(team.id) ||
                               thirdPlaceCandidates.some((candidate) => candidate.teamId === team.id)).map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </optgroup>
                        </select>

                        {/* Up/down buttons */}
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => { if (idx > 0) swapSlots(idx, idx - 1); }}
                            disabled={idx === 0}
                            className="h-3.5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                          >
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => { if (idx < bracketSize - 1) swapSlots(idx, idx + 1); }}
                            disabled={idx === bracketSize - 1}
                            className="h-3.5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                          >
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  };

                  return (
                    <div key={pairIdx} className="rounded-lg border border-border/50 overflow-hidden">
                      <div className="px-2 py-1 bg-muted/20 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground mono-font">Match {pairIdx + 1}</span>
                        {slotA === null && slotB !== null && (
                          <span className="text-xs text-yellow-400">· Seed {j + 1} gets a bye</span>
                        )}
                        {slotB === null && slotA !== null && (
                          <span className="text-xs text-yellow-400">· Seed {i + 1} gets a bye</span>
                        )}
                        {slotA === null && slotB === null && (
                          <span className="text-xs text-muted-foreground/50 italic">· Both slots empty</span>
                        )}
                      </div>
                      <div className="p-1.5 space-y-1">
                        {renderSlot(i, slotA)}
                        <div className="text-center text-xs text-muted-foreground/50 font-bold mono-font leading-none">vs</div>
                        {renderSlot(j, slotB)}
                      </div>
                    </div>
                  );
                })}
              </div>
              )}

              {/* Duplicate warning */}
              {duplicates.size > 0 && (
                <div className="mt-3 flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {[...duplicates].map((tid) => teamById[tid]?.name ?? `#${tid}`).join(", ")} {duplicates.size === 1 ? "appears" : "appear"} in multiple slots — each team can only be seeded once.
                  </span>
                </div>
              )}

              {/* Quick fill from standings */}
              {autoSuggestedSeeds.length > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => {
                      const slots: (number | null)[] = Array(isTop6 ? 6 : bracketSize).fill(null);
                      autoSuggestedSeeds.slice(0, isTop6 ? 6 : qualifierCount).forEach((tid, i) => { slots[i] = tid; });
                      setSeedSlots(slots);
                    }}
                  >
                     ↺ {isWildcardPlayoff ? (wildcardPlayoff?.qualifiedTeamIds ? "Reset to playoff result" : "Reset to automatic qualifiers") : "Reset to standings suggestions"}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    ({autoSuggestedSeeds.slice(0, qualifierCount).map(tid => teamById[tid]?.name ?? `#${tid}`).join(", ")})
                  </span>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="border-t border-border px-5 py-3 flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                {isTop6 && !isValid && <span className="text-destructive">Rank exactly six different qualifiers ({teamCount}/6)</span>}
                {isTop6 && isValid && <span className="text-green-400">Six seeds ranked. Seeds 1 and 2 get byes.</span>}
                {!isTop6 && !isValid && teamCount < 2 && <span className="text-destructive">Need at least 2 teams</span>}
                {!isTop6 && !isValid && isWildcardPlayoff && teamCount >= 2 && <span className="text-destructive">Include all six group qualifiers and exactly two third-place teams</span>}
                {!isTop6 && isValid && byeCount === 0 && <span className="text-green-400">Full bracket — no byes</span>}
                {!isTop6 && isValid && byeCount > 0 && (
                  <span className="text-yellow-400">{byeCount} team{byeCount !== 1 ? "s" : ""} will auto-advance in round 1</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="text-muted-foreground text-xs" onClick={() => setShowQualifierPicker(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!isValid || generateKnockout.isPending}
                  onClick={handleGenerateBracket}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider text-xs"
                >
                  <Trophy className="w-3.5 h-3.5 mr-1.5" />
                  {generateKnockout.isPending ? "Generating…" : "Generate Bracket"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isIndividualLadder && (
        <>
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-4xl font-bold display-font text-foreground tracking-wide">MATCHES</h2>
              <p className="text-muted-foreground mt-1">Enter scores or manage fixtures — click the pencil icon on any result</p>
            </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {legacyKnockout && knockoutMatches.length === 0 && (
            <Button
              size="sm"
              onClick={openQualifierPicker}
              disabled={generateKnockout.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider text-xs"
            >
              <Users className="w-3.5 h-3.5 mr-1.5" />
              Set Bracket Seeding
            </Button>
          )}

          {isTeamEvent && knockoutMatches.length === 0 && (
            <Card className={`border ${allGroupMatchesPlayed ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
              <CardContent className="p-4 space-y-4">
                <div>
                  <h3 className="font-bold text-foreground">Choose Knockout Teams</h3>
                  <p className="text-xs text-muted-foreground">The current standings are preselected. You can replace any qualifier before generating the crossover semifinals.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {([
                    ["a1TeamId", "Group A · Seed 1", teamEventGroupA],
                    ["a2TeamId", "Group A · Seed 2", teamEventGroupA],
                    ["b1TeamId", "Group B · Seed 1", teamEventGroupB],
                    ["b2TeamId", "Group B · Seed 2", teamEventGroupB],
                  ] as const).map(([key, label, candidates]) => (
                    <label key={key} className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
                      <select
                        value={teamEventSeeds[key]}
                        onChange={(event) => setTeamEventSeeds((current) => ({ ...current, [key]: Number(event.target.value) }))}
                        className="w-full rounded-md border border-border bg-background p-2 text-sm"
                        data-testid={`select-${key}`}
                      >
                        {candidates.map((standing) => <option key={standing.teamId} value={standing.teamId}>{standing.teamName}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <Button
                  size="sm"
                  onClick={() => generateTeamCrossover.mutate({ id: tournamentId, data: teamEventSeeds })}
                  disabled={generateTeamCrossover.isPending || new Set(Object.values(teamEventSeeds)).size !== 4}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider text-xs"
                  data-testid="button-generate-team-crossover"
                >
                  <Users className="w-3.5 h-3.5 mr-1.5" />
                  Generate Crossover
                </Button>
              </CardContent>
            </Card>
          )}


          {activeTab === "group" && (
            <>
              {confirmRegenerate ? (
                <>
                  <span className="text-xs text-muted-foreground">
                     {breakoutOn && breakoutState?.brackets.some((b) => b.matches.length > 0)
                       ? "This will erase the seeds and all results in BOTH breakout knockout brackets (bracket names and group assignments are kept) and all group scores. Continue?"
                       : knockoutMatches.length > 0 || (wildcardPlayoff?.matches.length ?? 0) > 0
                       ? "This will erase the knockout bracket, the third-place qualifier playoff and its scores, and all group scores. Continue?"
                       : "Clear all scores & reschedule?"}
                  </span>
                  <Button size="sm" variant="destructive" className="font-bold uppercase tracking-wider text-xs"
                    onClick={() => regenerateMatches.mutate({ id: tournamentId })} disabled={regenerateMatches.isPending}>
                    Regenerate
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => setConfirmRegenerate(false)}>Cancel</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:text-foreground text-xs"
                  onClick={() => setConfirmRegenerate(true)} disabled={knockoutUncertain}
                  title={knockoutUncertain ? "Loading bracket data…" : undefined}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Regenerate Fixtures
                </Button>
              )}
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider text-xs"
                onClick={() => { setShowAddForm(v => !v); setAddForm(EMPTY_FORM); }}>
                <Plus className="w-4 h-4 mr-1.5" />
                Add Fixture
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      {(legacyKnockout || isTeamEvent) && (
        <div className="flex gap-1 border-b border-border">
          <button onClick={() => setActiveTab("group")}
            className={`px-4 py-2 text-sm font-semibold tracking-wide transition-colors border-b-2 -mb-px ${activeTab === "group" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            Group Stage
          </button>
          <button onClick={() => setActiveTab("knockout")}
            className={`px-4 py-2 text-sm font-semibold tracking-wide transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${activeTab === "knockout" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Trophy className="w-3.5 h-3.5" />
            Knockout
            {knockoutMatches.length > 0 && <Badge variant="secondary" className="text-xs px-1 py-0 ml-1">Live</Badge>}
          </button>
        </div>
      )}

      {isWildcardPlayoff && (
        <WildcardPlayoffPanel
          tournamentId={tournamentId}
          organizer={isTournamentOrganizer}
          canStart={allGroupMatchesPlayed && knockoutMatches.length === 0}
          hasBracket={knockoutMatches.length > 0}
          selectedTeamIds={selectedThirdPlaceTeamIds}
          onManualSelection={openQualifierPicker}
          onUseResult={() => generateKnockout.mutate({ id: tournamentId, data: {} })}
        />
      )}

      {isBreakoutWildcardPlayoff && (
        <WildcardPlayoffPanel
          tournamentId={tournamentId}
          organizer={isTournamentOrganizer}
          canStart={allGroupMatchesPlayed && !breakoutGenerated}
          hasBracket={breakoutGenerated}
          onManualSelection={() => setBreakoutSeedRequest((n) => n + 1)}
        />
      )}

      {breakoutOn && (
        <BreakoutKnockoutsPanel
          tournamentId={tournamentId}
          groups={groups ?? []}
          teams={teams ?? []}
          seedRequest={breakoutSeedRequest}
          organizer={isTournamentOrganizer}
          allGroupMatchesPlayed={allGroupMatchesPlayed}
        />
      )}

      {/* ── Group Stage tab ── */}
      {(activeTab === "group" || breakoutOn) && (
        <>
          {/* Add fixture form */}
          {showAddForm && (
            <Card className="bg-card border border-primary/30">
              <CardContent className="p-4 space-y-4">
                <h3 className="font-bold display-font tracking-wide text-primary text-sm uppercase">New Fixture</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">Group</label>
                    <select value={addForm.groupId}
                      onChange={e => setAddForm({ ...addForm, groupId: e.target.value, homeTeamId: "", awayTeamId: "" })}
                      className="w-full h-9 rounded-md border border-border bg-background text-sm text-foreground px-2">
                      <option value="">Select group…</option>
                      {groups?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">Home Team</label>
                    <select value={addForm.homeTeamId}
                      onChange={e => setAddForm({ ...addForm, homeTeamId: e.target.value })}
                      disabled={!addForm.groupId}
                      className="w-full h-9 rounded-md border border-border bg-background text-sm text-foreground px-2 disabled:opacity-50">
                      <option value="">Select team…</option>
                      {formGroupTeams.filter(t => t.id !== parseInt(addForm.awayTeamId, 10) || !addForm.awayTeamId).map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">Away Team</label>
                    <select value={addForm.awayTeamId}
                      onChange={e => setAddForm({ ...addForm, awayTeamId: e.target.value })}
                      disabled={!addForm.groupId}
                      className="w-full h-9 rounded-md border border-border bg-background text-sm text-foreground px-2 disabled:opacity-50">
                      <option value="">Select team…</option>
                      {formGroupTeams.filter(t => t.id !== parseInt(addForm.homeTeamId, 10) || !addForm.homeTeamId).map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">Round</label>
                    <Input type="number" min={1} value={addForm.roundNumber}
                      onChange={e => setAddForm({ ...addForm, roundNumber: e.target.value })}
                      className="h-9 bg-background border-border text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground uppercase tracking-wider">Court (optional)</label>
                    <Input type="number" min={1} placeholder="—" value={addForm.courtNumber}
                      onChange={e => setAddForm({ ...addForm, courtNumber: e.target.value })}
                      className="h-9 bg-background border-border text-sm" />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider text-xs"
                    onClick={handleAddMatch} disabled={createMatch.isPending}>
                    <Check className="w-3.5 h-3.5 mr-1.5" />Add
                  </Button>
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground text-xs"
                    onClick={() => { setShowAddForm(false); setAddForm(EMPTY_FORM); }}>
                    <X className="w-3.5 h-3.5 mr-1.5" />Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Generate Knockout hint */}
          {legacyKnockout && knockoutMatches.length === 0 && (
            <Card className={`border ${allGroupMatchesPlayed ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <Trophy className={`w-5 h-5 shrink-0 ${allGroupMatchesPlayed ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1">
                  <p className={`text-sm font-semibold ${allGroupMatchesPlayed ? "text-primary" : "text-muted-foreground"}`}>
                    {allGroupMatchesPlayed
                      ? "All group matches played — seed the bracket and generate the knockout stage!"
                      : `Set bracket seeding at any time — assign teams, give byes, and generate the knockout stage (${matches?.filter(m => !m.played).length ?? "?"} group matches remaining).`}
                  </p>
                </div>
                <Button size="sm" onClick={openQualifierPicker} disabled={generateKnockout.isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider text-xs shrink-0">
                  <Users className="w-3.5 h-3.5 mr-1.5" />
                  Set Bracket Seeding
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Team game-count summary */}
          {groups && groups.length > 0 && teamGameCount.size > 0 && (
            <Card className="bg-card border border-border">
              <CardContent className="p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Games per Team</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {groups.map(group => {
                    const groupTeams = (teams ?? []).filter(t => t.groupId === group.id);
                    return (
                      <div key={group.id}>
                        <div className="text-xs font-bold text-primary display-font tracking-wide mb-1.5">{group.name}</div>
                        <div className="space-y-1">
                          {groupTeams.map(team => {
                            const counts = teamGameCount.get(team.id) ?? { total: 0, played: 0 };
                            const remaining = counts.total - counts.played;
                            return (
                              <div key={team.id} className="flex items-center justify-between gap-2 text-xs">
                                <span className="text-foreground truncate">{team.name}</span>
                                <div className="flex items-center gap-1.5 shrink-0 mono-font">
                                  <span className="text-muted-foreground">{counts.played}/{counts.total}</span>
                                  {remaining > 0 && <span className="text-blue-400">({remaining} left)</span>}
                                  {remaining === 0 && counts.total > 0 && <span className="text-green-400">✓</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider mr-2">View by:</span>
            <Button size="sm" variant={viewMode === "round" ? "default" : "outline"}
              onClick={() => { setViewMode("round"); setSelectedRound(null); setSelectedGroup(null); }}
              className={viewMode === "round" ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}>
              Round
            </Button>
            <Button size="sm" variant={viewMode === "group" ? "default" : "outline"}
              onClick={() => { setViewMode("group"); setSelectedGroup(null); setSelectedRound(null); }}
              className={viewMode === "group" ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}>
              Group
            </Button>
          </div>

          {viewMode === "round" && allRounds.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant={selectedRound === null ? "default" : "outline"}
                onClick={() => setSelectedRound(null)}
                className={selectedRound === null ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}>
                All Rounds
              </Button>
              {allRounds.map(r => (
                <Button key={r} size="sm" variant={selectedRound === r ? "default" : "outline"}
                  onClick={() => setSelectedRound(r)}
                  className={selectedRound === r ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}>
                  Round {r}
                </Button>
              ))}
            </div>
          )}

          {viewMode === "group" && groups && groups.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant={selectedGroup === null ? "default" : "outline"}
                onClick={() => setSelectedGroup(null)}
                className={selectedGroup === null ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}>
                All Groups
              </Button>
              {groups.map(g => (
                <Button key={g.id} size="sm" variant={selectedGroup === g.id ? "default" : "outline"}
                  onClick={() => setSelectedGroup(g.id)}
                  className={selectedGroup === g.id ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}>
                  {g.name}
                </Button>
              ))}
            </div>
          )}

          {(!matches || matches.length === 0) && !showAddForm && (
            <div className="py-20 text-center border-2 border-dashed border-border rounded-lg">
              <p className="text-muted-foreground mb-4">No matches found.</p>
              <a href={`/tournaments/${tournamentId}/settings`} className="text-primary hover:underline font-medium">Generate a tournament to create matches</a>
            </div>
          )}

          <div className="space-y-8">
            {groupedMatches.map(({ label, matches: sectionMatches }) => (
              <div key={label}>
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-lg font-bold display-font tracking-wide text-primary">{label}</h3>
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground mono-font">
                    {sectionMatches.filter(m => m.played).length}/{sectionMatches.length} played
                  </span>
                </div>
                <div className="space-y-2">
                  {sectionMatches.map((match) => {
                    const group = groups?.find(g => g.id === match.groupId);
                    const isEditing = editingScore?.matchId === match.id;
                    const isConfirmingDelete = deletingMatchId === match.id;
                    const homeWon = match.played && match.homeScore != null && match.awayScore != null && match.homeScore > match.awayScore;
                    const awayWon = match.played && match.homeScore != null && match.awayScore != null && match.awayScore > match.homeScore;
                    return (
                      <div key={match.id} className={`flex flex-col sm:flex-row sm:items-center rounded-md border transition-all ${match.played ? "bg-card border-primary/25" : "bg-card border-border"} ${isEditing ? "ring-1 ring-primary/50" : ""} ${isConfirmingDelete ? "ring-1 ring-destructive/50" : ""}`}>
                        <div className="flex flex-row sm:flex-col items-center justify-center w-full sm:w-24 px-2 py-2 sm:py-3 border-b sm:border-b-0 sm:border-r border-border gap-2 sm:gap-0.5 shrink-0">
                          {match.courtNumber != null && <span className="text-xs font-bold mono-font text-orange-400 uppercase">Court {match.courtNumber}</span>}
                          <span className="text-xs text-muted-foreground">{group?.name ?? "?"}</span>
                        </div>
                        <div className="flex-1 flex items-center px-2 sm:px-4 py-3 gap-2 sm:gap-3 min-w-0">
                          <span className={`flex-1 text-right font-semibold text-sm truncate ${homeWon ? "text-primary" : "text-foreground"}`}>
                            {match.homeTeamName ?? `#${match.homeTeamId}`}
                          </span>
                          <div className={`shrink-0 flex items-center justify-center ${isEditing || !match.played ? "w-full max-w-[240px]" : "w-24 sm:w-36"}`}>
                            {isTeamEvent ? (
                              match.played ? (
                                <div className="flex items-center gap-2">
                                  <span className={`text-2xl font-bold mono-font ${homeWon ? "text-primary" : "text-foreground"}`}>{match.homeScore}</span>
                                  <span className="text-muted-foreground text-sm">–</span>
                                  <span className={`text-2xl font-bold mono-font ${awayWon ? "text-primary" : "text-foreground"}`}>{match.awayScore}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground uppercase tracking-widest">Rubbers</span>
                              )
                            ) : isEditing ? (
                              <div className="flex w-full items-end justify-center gap-2">
                                <label className="min-w-0 flex-1 text-center">
                                  <span className="mb-1 block truncate text-[11px] font-semibold text-foreground">{match.homeTeamName ?? `#${match.homeTeamId}`}</span>
                                  <Input value={editingScore.homeScore} onChange={e => setEditingScore({ ...editingScore, homeScore: e.target.value })} className="mx-auto w-14 h-9 text-center bg-background border-border text-sm p-1" type="number" min={0} autoFocus onKeyDown={e => { if (e.key === "Enter") handleSaveScore(match.id); if (e.key === "Escape") setEditingScore(null); }} />
                                </label>
                                <span className="text-muted-foreground font-bold">–</span>
                                <label className="min-w-0 flex-1 text-center">
                                  <span className="mb-1 block truncate text-[11px] font-semibold text-foreground">{match.awayTeamName ?? `#${match.awayTeamId}`}</span>
                                  <Input value={editingScore.awayScore} onChange={e => setEditingScore({ ...editingScore, awayScore: e.target.value })} className="mx-auto w-14 h-9 text-center bg-background border-border text-sm p-1" type="number" min={0} onKeyDown={e => { if (e.key === "Enter") handleSaveScore(match.id); if (e.key === "Escape") setEditingScore(null); }} />
                                </label>
                              </div>
                            ) : match.played ? (
                              <div className="flex items-center gap-2">
                                <span className={`text-2xl font-bold mono-font ${homeWon ? "text-primary" : "text-foreground"}`}>{match.homeScore}</span>
                                <span className="text-muted-foreground text-sm">–</span>
                                <span className={`text-2xl font-bold mono-font ${awayWon ? "text-primary" : "text-foreground"}`}>{match.awayScore}</span>
                              </div>
                            ) : (
                              <div className="flex w-full items-end justify-center gap-2">
                                <label className="min-w-0 flex-1 text-center">
                                  <span className="mb-1 block truncate text-[11px] font-semibold text-foreground">{match.homeTeamName ?? `#${match.homeTeamId}`}</span>
                                  <Input value={pendingScores[match.id]?.home ?? ""} onChange={e => setPendingScores(prev => ({ ...prev, [match.id]: { home: e.target.value, away: prev[match.id]?.away ?? "" } }))} className="mx-auto w-14 h-9 text-center bg-background border-border text-sm p-1" type="number" min={0} placeholder="0" onKeyDown={e => { if (e.key === "Enter") handleSaveUnplayed(match.id); }} />
                                </label>
                                <span className="text-muted-foreground font-bold">–</span>
                                <label className="min-w-0 flex-1 text-center">
                                  <span className="mb-1 block truncate text-[11px] font-semibold text-foreground">{match.awayTeamName ?? `#${match.awayTeamId}`}</span>
                                  <Input value={pendingScores[match.id]?.away ?? ""} onChange={e => setPendingScores(prev => ({ ...prev, [match.id]: { home: prev[match.id]?.home ?? "", away: e.target.value } }))} className="mx-auto w-14 h-9 text-center bg-background border-border text-sm p-1" type="number" min={0} placeholder="0" onKeyDown={e => { if (e.key === "Enter") handleSaveUnplayed(match.id); }} />
                                </label>
                              </div>
                            )}
                          </div>
                          <span className={`flex-1 font-semibold text-sm truncate ${awayWon ? "text-primary" : "text-foreground"}`}>
                            {match.awayTeamName ?? `#${match.awayTeamId}`}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-1 px-3 py-1.5 sm:py-0 border-t sm:border-t-0 sm:border-l border-border shrink-0">
                          {isTeamEvent ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs text-primary hover:bg-primary/10"
                              onClick={() => setTieDialogParams({
                                matchId: match.id,
                                isKnockout: false,
                                homeId: match.homeTeamId,
                                awayId: match.awayTeamId,
                                homeName: match.homeTeamName ?? null,
                                awayName: match.awayTeamName ?? null,
                              })}
                              data-testid={`button-manage-team-event-tie-${match.id}`}
                            >
                              Lineups & Scores
                            </Button>
                          ) : isConfirmingDelete ? (
                            <>
                               <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:bg-destructive/10 px-2" onClick={() => handleDeleteMatch(match)}>Delete</Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setDeletingMatchId(null)}><X className="h-4 w-4" /></Button>
                            </>
                          ) : isEditing ? (
                            <>
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-green-400 hover:text-green-300 hover:bg-green-400/10" onClick={() => handleSaveScore(match.id)}><Check className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setEditingScore(null)}><X className="h-4 w-4" /></Button>
                            </>
                          ) : (() => {
                            const hasPending = pendingScores[match.id]?.home !== "" && pendingScores[match.id]?.away !== "" && pendingScores[match.id] !== undefined;
                            return (
                              <>
                                {!match.played && hasPending && (
                                  <>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-400 hover:text-green-300 hover:bg-green-400/10" onClick={() => handleSaveUnplayed(match.id)}><Check className="h-4 w-4" /></Button>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setPendingScores(prev => { const n = { ...prev }; delete n[match.id]; return n; })}><X className="h-4 w-4" /></Button>
                                  </>
                                )}
                                {!match.played && !match.startedAt && (
                                  <Button size="sm" variant="ghost" className="h-8 text-xs text-orange-400 hover:text-orange-300 hover:bg-orange-400/10 px-2" onClick={() => handleStartMatch(match.id)} disabled={startMatch.isPending} title="Start match">
                                    <Play className="h-3.5 w-3.5 mr-1" /> Start
                                  </Button>
                                )}
                                {!match.played && match.startedAt && (
                                  <Badge variant="outline" className="border-orange-400/40 text-orange-400 text-[10px]">In progress</Badge>
                                )}
                                {match.played && (
                                  <>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setEditingScore({ matchId: match.id, homeScore: match.homeScore?.toString() ?? "0", awayScore: match.awayScore?.toString() ?? "0" })}><Edit2 className="h-3.5 w-3.5" /></Button>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-orange-400 hover:bg-orange-400/10" onClick={() => handleResetMatch(match.id)} title="Reset score"><RotateCcw className="h-3.5 w-3.5" /></Button>
                                  </>
                                )}
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => setDeletingMatchId(match.id)} title="Remove fixture"><Trash2 className="h-3.5 w-3.5" /></Button>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Knockout tab ── */}
      {activeTab === "knockout" && !breakoutOn && (
        <>
          {isTop6 && <div className="mb-4"><Top6Info /></div>}
          <Dialog open={confirmResetBracket} onOpenChange={setConfirmResetBracket}>
            <DialogContent className="bg-card border-border text-foreground max-w-md">
              <DialogHeader>
                <DialogTitle className="display-font tracking-wide text-xl">RESET KNOCKOUT BRACKET?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                This deletes the current knockout bracket. All knockout scores and match progress will be lost, but group-stage results will stay unchanged.
              </p>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmResetBracket(false)}
                  disabled={resetKnockoutBracket.isPending}
                  data-testid="button-cancel-reset-bracket"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleResetBracket}
                  disabled={resetKnockoutBracket.isPending}
                  data-testid="button-confirm-reset-bracket"
                >
                  {resetKnockoutBracket.isPending ? "Resetting…" : "Reset Bracket"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {knockoutMatches.length === 0 ? (
            <div className="py-20 text-center border-2 border-dashed border-border rounded-lg">
              <Trophy className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
              <p className="text-muted-foreground mb-2">No knockout bracket yet.</p>
              {isTeamEvent ? (
                <button onClick={() => generateTeamCrossover.mutate({ id: tournamentId, data: teamEventSeeds })} disabled={generateTeamCrossover.isPending || new Set(Object.values(teamEventSeeds)).size !== 4} className="text-primary hover:underline font-medium">
                  {generateTeamCrossover.isPending ? "Generating..." : "Generate crossover from groups"}
                </button>
              ) : (
                <button onClick={openQualifierPicker} disabled={generateKnockout.isPending} className="text-primary hover:underline font-medium">
                  {generateKnockout.isPending ? "Generating..." : "Set bracket seeding and generate"}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {isTournamentOrganizer && knockoutHasScores && (
                  <div
                    className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
                    data-testid="status-knockout-reset-blocked"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Reset unavailable: one or more knockout matches already have scores. Reset those scores first.
                  </div>
                )}
                {isTournamentOrganizer && !knockoutHasScores && !knockoutUncertain && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setConfirmResetBracket(true)}
                    disabled={resetKnockoutBracket.isPending}
                    data-testid="button-reset-knockout-bracket"
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Reset Bracket
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => refetchKnockout()}>
                  <RefreshCw className="w-3 h-3 mr-1.5" />Refresh
                </Button>
              </div>

              {/* ── Podium: top 3 ── */}
              {(() => {
                const finalMatch = knockoutMatches.find(m => m.round === "final" || m.round === "grand_final");
                const champion = finalMatch?.played ? finalMatch.winnerName : null;
                const runnerUp = finalMatch?.played
                  ? (finalMatch.winnerId === finalMatch.homeTeamId ? finalMatch.awayTeamName : finalMatch.homeTeamName)
                  : null;

                // 3rd: explicit third_place round first, then semi losers
                const thirdPlaceMatch = knockoutMatches.find(m => m.round === "third_place");
                const semiMatches = knockoutMatches.filter(m => m.round === "semi" && m.played);
                const thirdPlacers: string[] = thirdPlaceMatch?.played && thirdPlaceMatch.winnerName
                  ? [thirdPlaceMatch.winnerName]
                  : semiMatches.flatMap(m => {
                      const loser = m.winnerId === m.homeTeamId ? m.awayTeamName : m.homeTeamName;
                      return loser ? [loser] : [];
                    });

                if (!champion && thirdPlacers.length === 0) return null;

                return (
                  <div className="rounded-xl border border-yellow-400/20 bg-gradient-to-b from-yellow-400/5 to-transparent p-5">
                    <div className="flex items-center gap-2 mb-5">
                      <Trophy className="w-4 h-4 text-yellow-400" />
                      <h3 className="text-sm font-bold uppercase tracking-widest text-yellow-400">Tournament Standings</h3>
                    </div>

                    <div className="flex items-end justify-center gap-3">

                      {/* 🥈 Runner-up — left pedestal (shorter) */}
                      <div className="flex flex-col items-center gap-2 flex-1 max-w-[180px]">
                        <div className="text-3xl">🥈</div>
                        <div className="text-center">
                          <div className={`text-sm font-bold ${runnerUp ? "text-foreground" : "text-muted-foreground/40 italic"}`}>
                            {runnerUp ?? "—"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">Runner-up</div>
                        </div>
                        <div className="w-full h-14 rounded-t-md bg-muted/40 border border-border/50 flex items-center justify-center">
                          <span className="text-2xl font-black text-muted-foreground/30">2</span>
                        </div>
                      </div>

                      {/* 🥇 Champion — centre pedestal (tallest) */}
                      <div className="flex flex-col items-center gap-2 flex-1 max-w-[200px]">
                        <div className="text-4xl drop-shadow-lg">🥇</div>
                        <div className="text-center">
                          <div className={`text-base font-bold ${champion ? "text-yellow-300" : "text-muted-foreground/40 italic"}`}>
                            {champion ?? "TBD"}
                          </div>
                          <div className="text-xs text-yellow-400/70 mt-0.5">Champion</div>
                        </div>
                        <div className="w-full h-20 rounded-t-md bg-yellow-400/10 border border-yellow-400/30 flex items-center justify-center">
                          <span className="text-3xl font-black text-yellow-400/25">1</span>
                        </div>
                      </div>

                      {/* 🥉 3rd place — right pedestal (shorter) */}
                      <div className="flex flex-col items-center gap-2 flex-1 max-w-[180px]">
                        <div className="text-3xl">🥉</div>
                        <div className="text-center min-h-[40px]">
                          {thirdPlacers.length === 0 ? (
                            <div className="text-sm font-bold text-muted-foreground/40 italic">—</div>
                          ) : thirdPlacers.length === 1 ? (
                            <>
                              <div className="text-sm font-bold text-foreground">{thirdPlacers[0]}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">3rd place</div>
                            </>
                          ) : (
                            <>
                              {thirdPlacers.map((n, i) => (
                                <div key={i} className="text-xs font-semibold text-foreground leading-tight">{n}</div>
                              ))}
                              <div className="text-xs text-muted-foreground mt-0.5">Joint 3rd</div>
                            </>
                          )}
                        </div>
                        <div className="w-full h-10 rounded-t-md bg-muted/40 border border-border/50 flex items-center justify-center">
                          <span className="text-xl font-black text-muted-foreground/30">3</span>
                        </div>
                      </div>

                    </div>
                  </div>
                );
              })()}

              {/* ── Single-elimination: visual bracket ── */}
              {!isDoubleElim && (
                <div className="flex flex-col xl:flex-row gap-6 items-start">
                  <div className="min-w-0 w-full flex-1">
                    <BracketView
                      rounds={knockoutByRound}
                      knockoutScore={knockoutScore}
                      setKnockoutScore={setKnockoutScore}
                      onSave={handleSaveKnockoutScore}
                      onStart={handleStartKnockoutMatch}
                      isPending={updateKnockoutMatch.isPending}
                      isStarting={startKnockoutMatch.isPending}
                      isTeamEvent={isTeamEvent}
                      onOpenTeamEventTie={(match) => setTieDialogParams({
                        matchId: match.id,
                        isKnockout: true,
                        homeId: match.homeTeamId ?? null,
                        awayId: match.awayTeamId ?? null,
                        homeName: match.homeTeamName ?? null,
                        awayName: match.awayTeamName ?? null,
                      })}
                    />
                  </div>
                  {knockoutMatches.some(m => m.round === "third_place") && (
                    <aside className="w-full xl:w-[260px] shrink-0 rounded-lg border border-border bg-card/50 p-3" aria-label="Third place playoff">
                      <p className="text-xs text-muted-foreground mb-2">Separate playoff · not part of the final bracket</p>
                      <BracketView
                        rounds={[{ round: "third_place", label: "Third Place Playoff", matches: knockoutMatches.filter(m => m.round === "third_place") }]}
                        knockoutScore={knockoutScore}
                        setKnockoutScore={setKnockoutScore}
                        onSave={handleSaveKnockoutScore}
                        onStart={handleStartKnockoutMatch}
                        isPending={updateKnockoutMatch.isPending}
                        isStarting={startKnockoutMatch.isPending}
                        isTeamEvent={isTeamEvent}
                        onOpenTeamEventTie={(match) => setTieDialogParams({
                          matchId: match.id, isKnockout: true,
                          homeId: match.homeTeamId ?? null, awayId: match.awayTeamId ?? null,
                          homeName: match.homeTeamName ?? null, awayName: match.awayTeamName ?? null,
                        })}
                      />
                    </aside>
                  )}
                </div>
              )}

              {/* ── Double-elimination: sectioned round list ── */}
              {isDoubleElim && (() => {
                const renderRound = (round: string, label: string, roundMatches: KnockoutMatch[]) => (
                  <div key={round}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex items-center gap-2">
                        {(round === "final" || round === "grand_final") && <Trophy className="w-5 h-5 text-yellow-400" />}
                        {round !== "final" && round !== "grand_final" && <Zap className="w-4 h-4 text-primary" />}
                        <h3 className="text-xl font-bold display-font tracking-wide text-foreground">{label.toUpperCase()}</h3>
                      </div>
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-xs text-muted-foreground mono-font">
                        {roundMatches.filter(m => m.played).length}/{roundMatches.filter(m => m.homeTeamId && m.awayTeamId).length} played
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {roundMatches.map((match) => {
                        const isEditing = knockoutScore?.matchId === match.id;
                        const homeWon = match.played && match.homeScore != null && match.awayScore != null && match.homeScore > match.awayScore;
                        const awayWon = match.played && match.homeScore != null && match.awayScore != null && match.awayScore > match.homeScore;
                        const isTbd = !match.homeTeamId || !match.awayTeamId;
                        const isAutoWin = match.played && isTbd;
                        const isFinalMatch = round === "final" || round === "grand_final";
                        return (
                          <Card key={match.id} className={`bg-card border ${isFinalMatch ? "border-yellow-400/30" : match.played ? "border-primary/25" : isTbd ? "border-border/50 opacity-60" : "border-border"} ${isEditing ? "ring-1 ring-primary/50" : ""}`}>
                            <CardContent className="p-3">
                              <div className="text-xs text-muted-foreground mono-font mb-2 flex items-center justify-between">
                                <span>Match {match.matchNumber}</span>
                                {match.winnerName && <span className="text-primary font-semibold">WINNER: {match.winnerName}</span>}
                              </div>
                              {isAutoWin ? (
                                <div className="text-sm text-center text-muted-foreground py-1">
                                  <span className="font-semibold text-primary">{match.homeTeamName ?? match.awayTeamName}</span> — bye
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className={`flex-1 text-right text-sm font-semibold truncate ${homeWon ? "text-primary" : isTbd ? "text-muted-foreground italic" : "text-foreground"}`}>
                                    {match.homeTeamName ?? "TBD"}
                                  </span>
                                  <div className={`shrink-0 flex items-center justify-center ${isEditing ? "w-36" : "w-24"}`}>
                                    {isEditing ? (
                                      <div className="flex items-center gap-1">
                                        <Input value={knockoutScore!.homeScore} onChange={e => setKnockoutScore({ ...knockoutScore!, homeScore: e.target.value })} className="w-16 h-12 text-center bg-background border-border text-base p-2" aria-label={`${match.homeTeamName ?? "Home team"} score`} type="number" inputMode="numeric" min={0} autoFocus onKeyDown={e => { if (e.key === "Enter") handleSaveKnockoutScore(match.id); if (e.key === "Escape") setKnockoutScore(null); }} />
                                        <span className="text-muted-foreground text-xs font-bold">–</span>
                                        <Input value={knockoutScore!.awayScore} onChange={e => setKnockoutScore({ ...knockoutScore!, awayScore: e.target.value })} className="w-16 h-12 text-center bg-background border-border text-base p-2" aria-label={`${match.awayTeamName ?? "Away team"} score`} type="number" inputMode="numeric" min={0} onKeyDown={e => { if (e.key === "Enter") handleSaveKnockoutScore(match.id); if (e.key === "Escape") setKnockoutScore(null); }} />
                                      </div>
                                    ) : match.played ? (
                                      <div className="flex items-center gap-1.5">
                                        <span className={`text-lg font-bold mono-font ${homeWon ? "text-primary" : "text-foreground"}`}>{match.homeScore}</span>
                                        <span className="text-muted-foreground text-xs">–</span>
                                        <span className={`text-lg font-bold mono-font ${awayWon ? "text-primary" : "text-foreground"}`}>{match.awayScore}</span>
                                      </div>
                                    ) : isTbd ? (
                                      <span className="text-xs text-muted-foreground italic">TBD</span>
                                    ) : (
                                      <span className="text-xs text-muted-foreground uppercase tracking-widest">vs</span>
                                    )}
                                  </div>
                                  <span className={`flex-1 text-sm font-semibold truncate ${awayWon ? "text-primary" : isTbd ? "text-muted-foreground italic" : "text-foreground"}`}>
                                    {match.awayTeamName ?? "TBD"}
                                  </span>
                                </div>
                              )}
                              {!isTbd && !match.played && !isAutoWin && !isEditing && (
                                <div className="mt-2 flex justify-end gap-1">
                                  {!match.startedAt && (
                                    <Button size="sm" variant="ghost" className="h-11 text-sm text-orange-400 hover:text-orange-300"
                                      onClick={() => handleStartKnockoutMatch(match.id)} disabled={startKnockoutMatch.isPending}>
                                      <Play className="h-3 w-3 mr-1" /> Start
                                    </Button>
                                  )}
                                  <Button size="sm" variant="ghost" className="h-11 text-sm text-muted-foreground hover:text-foreground"
                                    onClick={() => setKnockoutScore({ matchId: match.id, homeScore: "", awayScore: "" })}>
                                    <Edit2 className="h-3 w-3 mr-1" /> Enter score
                                  </Button>
                                </div>
                              )}
                              {isEditing && (
                                <div className="mt-4 flex justify-between gap-4">
                                  <Button variant="outline" className="h-12 flex-1 text-green-400 hover:text-green-300 hover:bg-green-400/10" onClick={() => handleSaveKnockoutScore(match.id)} disabled={updateKnockoutMatch.isPending}><Check className="h-4 w-4 mr-1" />Save</Button>
                                  <Button variant="outline" className="h-12 flex-1 text-destructive hover:bg-destructive/10" onClick={() => setKnockoutScore(null)} disabled={updateKnockoutMatch.isPending}><X className="h-4 w-4 mr-1" />Cancel</Button>
                                </div>
                              )}
                              {match.played && !isAutoWin && !isEditing && (
                                <div className="mt-2 flex justify-end">
                                  <Button size="sm" variant="ghost" className="h-11 text-sm text-muted-foreground hover:text-foreground"
                                    onClick={() => setKnockoutScore({ matchId: match.id, homeScore: match.homeScore?.toString() ?? "0", awayScore: match.awayScore?.toString() ?? "0" })}>
                                    <Edit2 className="h-3 w-3 mr-1" /> Edit
                                  </Button>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                );

                return (
                  <div className="space-y-10">
                    {wbSections.length > 0 && (
                      <div className="space-y-8">
                        <div className="flex items-center gap-3">
                          <Trophy className="w-5 h-5 text-primary" />
                          <h3 className="text-lg font-bold display-font tracking-widest text-primary uppercase">Winner Bracket</h3>
                          <div className="flex-1 h-px bg-primary/20" />
                        </div>
                        <div className="space-y-8 pl-3 border-l-2 border-primary/20">
                          {wbSections.map(({ round, label, matches }) => renderRound(round, label, matches))}
                        </div>
                      </div>
                    )}
                    {lbSections.length > 0 && (
                      <div className="space-y-8">
                        <div className="flex items-center gap-3">
                          <Zap className="w-5 h-5 text-orange-400" />
                          <h3 className="text-lg font-bold display-font tracking-widest text-orange-400 uppercase">Loser Bracket</h3>
                          <div className="flex-1 h-px bg-orange-400/20" />
                        </div>
                        <div className="space-y-8 pl-3 border-l-2 border-orange-400/20">
                          {lbSections.map(({ round, label, matches }) => renderRound(round, label, matches))}
                        </div>
                      </div>
                    )}
                    {gfMatches.filter(m => m.round === "grand_final").length > 0 && renderRound("grand_final", "Grand Final", gfMatches.filter(m => m.round === "grand_final"))}
                    {gfMatches.filter(m => m.round === "grand_final_reset").length > 0 && renderRound("grand_final_reset", "Grand Final — Reset", gfMatches.filter(m => m.round === "grand_final_reset"))}
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}
        </>
      )}

      {tieDialogParams && (
        <TeamEventTieDialog
          tournamentId={tournamentId}
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
