import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTournamentById,
  useUpdateTournamentById,
  useReopenTournament,
  useGenerateTournament,
  useListTournamentGroups,
  useListTournamentTeams,
  useUpdateTeam,
  useListTournamentCoOrganizers,
  useAddTournamentCoOrganizer,
  useRemoveTournamentCoOrganizer,
  useListKnockoutMatches,
  useGetWildcardPlayoff,
  getGetWildcardPlayoffQueryKey,
  useListTournamentStandings,
  useListLadderState,
  useSetLadderParticipants,
  getGetTournamentByIdQueryKey,
  useGetTeamEventState,
  useUpdateTeamEventConfig,
  getGetTeamEventStateQueryKey,
  type TeamEventTemplateInput,
  getListTournamentGroupsQueryKey,
  getListTournamentTeamsQueryKey,
  getListTournamentMatchesQueryKey,
  getListTournamentStandingsQueryKey,
  getListTournamentsQueryKey,
  getListTournamentCoOrganizersQueryKey,
  getListKnockoutMatchesQueryKey,
  getListLadderStateQueryKey,
  getGetBreakoutKnockoutsQueryKey,
} from "@workspace/api-client-react";
import { useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BreakoutConfigCard, isGroupBasedFormat, useBreakoutState } from "./BreakoutKnockouts";
import { GroupNamesEditor } from "./GroupNamesEditor";
import { Top6Info, type KnockoutMode } from "./Top6Info";
import { RefreshCw, Save, Edit2, Check, X, ChevronUp, ChevronDown, RotateCcw, UserPlus, UserMinus } from "lucide-react";

export default function Settings() {
  const { id } = useParams<{ id: string }>();
  const tournamentId = Number(id);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: tournament, isLoading } = useGetTournamentById(tournamentId);
  const { data: groups } = useListTournamentGroups(tournamentId);
  const { data: teams } = useListTournamentTeams(tournamentId);
  const { data: knockoutMatches = [], isLoading: isLoadingKnockout } = useListKnockoutMatches(tournamentId, {
    query: {
      queryKey: getListKnockoutMatchesQueryKey(tournamentId),
      enabled: tournament?.format === "group_knockout",
    },
  });
  const { data: wildcardPlayoff, isLoading: isLoadingWildcardPlayoff } = useGetWildcardPlayoff(tournamentId, {
    query: { enabled: tournament?.format === "group_knockout", queryKey: getGetWildcardPlayoffQueryKey(tournamentId) },
  });

  const { data: teamEventState } = useGetTeamEventState(tournamentId, {
    query: {
      queryKey: getGetTeamEventStateQueryKey(tournamentId),
      enabled: tournament?.format === "team_event",
    },
  });

  const { data: ladderState } = useListLadderState(tournamentId, {
    query: {
      queryKey: getListLadderStateQueryKey(tournamentId),
      enabled: tournament?.format === "individual_ladder" || tournament?.format === "americano",
    },
  });

  // While bracket data is still loading we don't know if one exists yet,
  // so block the destructive action until bracket existence is confirmed.
  const isSavedGroupBased = isGroupBasedFormat(tournament?.format);
  const { data: breakoutState, isLoading: isLoadingBreakout } = useBreakoutState(tournamentId, isSavedGroupBased);
  const breakoutOn = isSavedGroupBased && !!breakoutState?.enabled;
  const breakoutGenerated = !!breakoutState?.brackets.some((b) => b.matches.length > 0);
  const breakoutConfigured = !!breakoutState?.enabled || (breakoutState?.brackets.length ?? 0) > 0;
  const knockoutUncertain = (tournament?.format === "group_knockout" && (isLoadingKnockout || isLoadingWildcardPlayoff))
    || (isSavedGroupBased && isLoadingBreakout);

  const [name, setName] = useState("");
  const [groupCount, setGroupCount] = useState(4);
  const [teamsPerGroup, setTeamsPerGroup] = useState(4);
  const [courtCount, setCourtCount] = useState(2);
  const [format, setFormat] = useState<"round_robin" | "group_knockout" | "individual_ladder" | "americano" | "team_event">("round_robin");
  const [qualifiersPerGroup, setQualifiersPerGroup] = useState(2);
  const [wildcardQualifiers, setWildcardQualifiers] = useState(0);
  const [wildcardRankingMethod, setWildcardRankingMethod] = useState<"points" | "ppg">("points");
  const [wildcardSelectionMethod, setWildcardSelectionMethod] = useState<"ranking" | "round_robin">("ranking");
  const [knockoutFormat, setKnockoutFormat] = useState<KnockoutMode>("single");
  const [thirdPlacePlayoffEnabled, setThirdPlacePlayoffEnabled] = useState(true);
  const [tiebreakerOrder, setTiebreakerOrder] = useState<string[]>(["goal_difference", "goals_for", "goals_against", "head_to_head"]);
  const [coOrgEmail, setCoOrgEmail] = useState("");
  const [editingTeam, setEditingTeam] = useState<{ id: number; name: string } | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [ladderParticipantsStr, setLadderParticipantsStr] = useState("");
  const [minMen, setMinMen] = useState(0);
  const [minWomen, setMinWomen] = useState(0);
  const [dreambreakerEnabled, setDreambreakerEnabled] = useState(false);
  const [teamEventTemplates, setTeamEventTemplates] = useState<TeamEventTemplateInput[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const { user } = useUser();
  const isOwner = tournament && user && (tournament as any).createdBy === user.id;
  const canManageOrganizers = Boolean(isOwner || isAdmin);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/organizers", { credentials: "include" })
      .then((response) => {
        if (active) setIsAdmin(response.ok);
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (tournament) {
      setName(tournament.name);
      setGroupCount(tournament.groupCount);
      setTeamsPerGroup(tournament.teamsPerGroup);
      setCourtCount(tournament.courtCount);
      setFormat((tournament.format as "round_robin" | "group_knockout" | "individual_ladder" | "americano" | "team_event") ?? "round_robin");
      setQualifiersPerGroup(tournament.qualifiersPerGroup ?? 2);
      setWildcardQualifiers(tournament.wildcardQualifiers ?? 0);
      setWildcardRankingMethod(tournament.wildcardRankingMethod ?? "points");
      setWildcardSelectionMethod(tournament.wildcardSelectionMethod ?? "ranking");
      setKnockoutFormat(((tournament as any).knockoutFormat as KnockoutMode) ?? "single");
      setThirdPlacePlayoffEnabled(tournament.thirdPlacePlayoffEnabled ?? true);
      if (tournament.format === "team_event" && !teamEventTemplates.length) {
        setTeamEventTemplates([
          { stage: "group", order: 1, matchType: "mens_doubles", targetPoints: 21, bestOf: 3 },
          { stage: "group", order: 2, matchType: "mixed_doubles", targetPoints: 21, bestOf: 3 },
          { stage: "knockout", order: 1, matchType: "mens_doubles", targetPoints: 21, bestOf: 3 },
          { stage: "knockout", order: 2, matchType: "mixed_doubles", targetPoints: 21, bestOf: 3 },
          { stage: "knockout", order: 3, matchType: "mixed_doubles", targetPoints: 21, bestOf: 3, disallowSameMaleFromPreviousMixed: true }
        ]);
      }
      const raw = (tournament as any).tiebreakerOrder as string | undefined;
      if (raw) setTiebreakerOrder(raw.split(",").map((s: string) => s.trim()));
    }
  }, [tournament]);

  useEffect(() => {
    if (ladderState && ladderState.participants) {
      setLadderParticipantsStr(ladderState.participants.map(p => p.name).join("\n"));
    }
  }, [ladderState]);

  useEffect(() => {
    if (teamEventState) {
      if (teamEventState.config) {
        setMinMen(teamEventState.config.minMen ?? 0);
        setMinWomen(teamEventState.config.minWomen ?? 0);
        setDreambreakerEnabled(teamEventState.config.dreambreakerEnabled ?? false);
      }
      if (teamEventState.templates?.length > 0) {
        setTeamEventTemplates(teamEventState.templates);
      }
    }
  }, [teamEventState]);

  const { data: coOrganizers } = useListTournamentCoOrganizers(tournamentId);

  const addCoOrganizer = useAddTournamentCoOrganizer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTournamentCoOrganizersQueryKey(tournamentId) });
        setCoOrgEmail("");
        toast({ title: "Co-organizer added" });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? "Failed to add co-organizer.";
        toast({ title: "Error", description: msg, variant: "destructive" });
      },
    },
  });

  const removeCoOrganizer = useRemoveTournamentCoOrganizer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTournamentCoOrganizersQueryKey(tournamentId) });
        toast({ title: "Co-organizer removed" });
      },
      onError: () => toast({ title: "Error", description: "Failed to remove co-organizer.", variant: "destructive" }),
    },
  });

  const reopenTournament = useReopenTournament({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTournamentByIdQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        toast({ title: "Tournament reopened", description: "The tournament is now active again." });
      },
      onError: () => toast({ title: "Error", description: "Failed to reopen tournament.", variant: "destructive" }),
    },
  });

  const updateTournament = useUpdateTournamentById({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTournamentByIdQueryKey(tournamentId) });
        toast({ title: "Settings saved", description: "Tournament settings updated." });
      },
      onError: () => toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" }),
    },
  });

  const updateTeamEventConfig = useUpdateTeamEventConfig({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTeamEventStateQueryKey(tournamentId) });
      },
      onError: () => toast({ title: "Error", description: "Failed to save team event config.", variant: "destructive" }),
    },
  });

  const setLadderParticipants = useSetLadderParticipants({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLadderStateQueryKey(tournamentId) });
      },
      onError: () => toast({ title: "Error", description: "Failed to save ladder participants.", variant: "destructive" }),
    },
  });

  const generateTournament = useGenerateTournament({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTournamentByIdQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentGroupsQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentTeamsQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentStandingsQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getGetWildcardPlayoffQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getGetBreakoutKnockoutsQueryKey(tournamentId) });
        setConfirmGenerate(false);
        toast({ title: "Tournament generated", description: "Groups, teams, and matches created with balanced scheduling." });
      },
      onError: () => toast({ title: "Error", description: "Failed to generate tournament.", variant: "destructive" }),
    },
  });

  const updateTeam = useUpdateTeam({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTournamentTeamsQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentStandingsQueryKey(tournamentId) });
        setEditingTeam(null);
      },
      onError: () => toast({ title: "Error", description: "Failed to update team.", variant: "destructive" }),
    },
  });

  const totalTeams = groupCount * teamsPerGroup;
  const maxWildcardQualifiers = Math.max(0, totalTeams - groupCount * qualifiersPerGroup);
  const matchesPerGroup = (teamsPerGroup * (teamsPerGroup - 1)) / 2;
  const totalMatches = groupCount * matchesPerGroup;
  const roundsPerGroup = teamsPerGroup % 2 === 0 ? teamsPerGroup - 1 : teamsPerGroup;

  const totalQualifiers = groupCount * qualifiersPerGroup + wildcardQualifiers;
  // Breakouts route the normal qualifiers into two brackets (2..64 each); legacy single bracket caps at 32.
  const usesQualifiers = format === "group_knockout" || (format === "round_robin" && breakoutOn);
  const minQualifiers = breakoutOn ? 4 : 2;
  const maxQualifiers = breakoutOn ? 128 : 32;
  const qualifierCountValid = !usesQualifiers || (totalQualifiers >= minQualifiers && totalQualifiers <= maxQualifiers);
  const savedKnockoutFormat = ((tournament as any)?.knockoutFormat as KnockoutMode | undefined) ?? "single";
  const knockoutModeLocked = knockoutMatches.length > 0 || breakoutGenerated;
  const effectiveKnockoutFormat: KnockoutMode = !usesQualifiers ? "single" : breakoutOn && knockoutFormat === "double" ? "single" : knockoutFormat;
  const ladderNames = ladderParticipantsStr.split("\n").map((value) => value.trim()).filter(Boolean);
  const isIndividualFormat = format === "individual_ladder" || format === "americano";
  const ladderMinimumPlayers = format === "americano" ? courtCount * 4 : (courtCount === 3 ? 20 : courtCount * 4);
  const ladderStartReady = format === "americano"
    ? ladderNames.length === ladderMinimumPlayers
    : ladderNames.length >= ladderMinimumPlayers && ladderNames.length % 2 === 0;

  function bracketRoundName(total: number): string {
    if (total <= 2) return "Final";
    if (total <= 4) return "Semifinals";
    if (total <= 8) return "Quarterfinals";
    if (total <= 16) return "Round of 16";
    if (total <= 32) return "Round of 32";
    return `${total} qualifiers — max is 32`;
  }

  const tournamentData = () => ({
    name, groupCount, teamsPerGroup, courtCount, format,
    qualifiersPerGroup: usesQualifiers ? qualifiersPerGroup : null,
    wildcardQualifiers: usesQualifiers ? wildcardQualifiers : 0,
    wildcardRankingMethod: usesQualifiers ? wildcardRankingMethod : "points",
    wildcardSelectionMethod: usesQualifiers ? wildcardSelectionMethod : "ranking",
    knockoutFormat: knockoutModeLocked ? savedKnockoutFormat : effectiveKnockoutFormat,
    thirdPlacePlayoffEnabled,
    tiebreakerOrder: tiebreakerOrder.join(","),
  } as any);

  const moveTiebreaker = (index: number, direction: -1 | 1) => {
    const next = [...tiebreakerOrder];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setTiebreakerOrder(next);
  };

  const TIEBREAKER_LABELS: Record<string, string> = {
    goal_difference: "Goal Difference (GF − GA)",
    goals_for: "Goals Scored (most first)",
    goals_against: "Goals Conceded (fewest first)",
    head_to_head: "Head-to-Head Result",
  };

  const validPlayoffConfiguration = () => {
    if (knockoutModeLocked && usesQualifiers && effectiveKnockoutFormat !== savedKnockoutFormat) {
      toast({ title: "Reset required", description: "A knockout draw already exists. Reset it from Matches before changing the knockout format. Results are never cleared automatically.", variant: "destructive" });
      return false;
    }
    if (usesQualifiers && !breakoutOn && effectiveKnockoutFormat === "top6" && totalQualifiers !== 6) {
      toast({ title: "Top 6 Playoff needs six qualifiers", description: `The current rules produce ${totalQualifiers}. Adjust qualifiers per group or additional places to total exactly 6.`, variant: "destructive" });
      return false;
    }
    if (usesQualifiers && wildcardSelectionMethod === "round_robin" &&
        (groupCount !== 3 || teamsPerGroup < 3 || qualifiersPerGroup !== 2 || wildcardQualifiers !== 2)) {
      toast({ title: "Playoff needs three groups", description: "Choose at least three teams per group, two qualifiers per group and two additional places.", variant: "destructive" });
      return false;
    }
    return true;
  };

  const handleSave = () => {
    if (!validPlayoffConfiguration()) return;
    if (isIndividualFormat) {
      const validCourtCount = format === "americano"
        ? courtCount >= 1 && courtCount <= 3
        : courtCount === 2 || courtCount === 3;
      if (!validCourtCount) {
        toast({
          title: format === "americano" ? "Choose one to three courts" : "Choose two or three courts",
          description: format === "americano" ? "Americano supports 1, 2, or 3 courts." : "Individual Ladder is designed for two or three courts.",
          variant: "destructive",
        });
        return;
      }
      if (ladderNames.length === 0) {
        toast({ title: "Add player names", description: "Enter one player on each line before saving the ladder.", variant: "destructive" });
        return;
      }
    }

    if (format === "team_event") {
      const knockoutCount = teamEventTemplates.filter(t => t.stage === 'knockout').length;
      if (knockoutCount > 0 && knockoutCount % 2 === 0 && !dreambreakerEnabled) {
        toast({ title: "Tie breaker required", description: "Enable Dreambreaker or use an odd number of knockout rubbers.", variant: "destructive" });
        return;
      }
      if (dreambreakerEnabled && (minMen < 2 || minWomen < 2)) {
        toast({ title: "Roster minimum too small", description: "Dreambreaker requires at least two men and two women per roster.", variant: "destructive" });
        return;
      }
    }

    updateTournament.mutate(
      { id: tournamentId, data: tournamentData() },
      {
        onSuccess: () => {
          if (isIndividualFormat) {
            setLadderParticipants.mutate({ id: tournamentId, data: { names: ladderNames } });
          } else if (format === "team_event") {
            updateTeamEventConfig.mutate({
              id: tournamentId,
              data: { minMen, minWomen, dreambreakerEnabled, templates: teamEventTemplates }
            });
          }
        },
      },
    );
  };

  const handleGenerate = () => {
    if (!validPlayoffConfiguration()) return;
    if (knockoutUncertain) return;
    if ((knockoutMatches.length > 0 || (wildcardPlayoff?.matches.length ?? 0) > 0 || breakoutGenerated || breakoutConfigured) && !confirmGenerate) {
      setConfirmGenerate(true);
      return;
    }
    setConfirmGenerate(false);
    updateTournament.mutate(
      { id: tournamentId, data: tournamentData() },
      { onSuccess: () => { generateTournament.mutate({ id: tournamentId }); } }
    );
  };

  const handleSaveTeam = (teamId: number, groupId: number) => {
    if (!editingTeam) return;
    updateTeam.mutate({ id: teamId, data: { name: editingTeam.name, groupId } });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64 bg-card" />
        <Skeleton className="h-64 bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h2 className="text-4xl font-bold display-font text-foreground tracking-wide">TOURNAMENT SETUP</h2>
        <p className="text-muted-foreground mt-1">Configure your tournament structure</p>
      </div>

      <Card className="bg-card border border-border">
        <CardHeader>
          <CardTitle className="display-font text-xl tracking-wide text-primary">TOURNAMENT SETTINGS</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Tournament Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter tournament name"
              className="bg-background border-border text-foreground text-lg h-12"
            />
          </div>

          {/* Format selector */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Tournament Format</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <button
                type="button"
                onClick={() => setFormat("round_robin")}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${format === "round_robin" ? "border-primary bg-primary/10" : "border-border bg-background/50 hover:border-border/80"}`}
              >
                <div className={`font-bold text-sm display-font tracking-wide mb-1 ${format === "round_robin" ? "text-primary" : "text-foreground"}`}>ROUND ROBIN</div>
                <div className="text-xs text-muted-foreground">Every team plays every other team in their group. Final standings decide the winner.</div>
              </button>
              <button
                type="button"
                onClick={() => setFormat("group_knockout")}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${format === "group_knockout" ? "border-primary bg-primary/10" : "border-border bg-background/50 hover:border-border/80"}`}
              >
                <div className={`font-bold text-sm display-font tracking-wide mb-1 ${format === "group_knockout" ? "text-primary" : "text-foreground"}`}>GROUP → KNOCKOUT</div>
                <div className="text-xs text-muted-foreground">Group stage followed by a single-elimination bracket. Top teams advance.</div>
              </button>
              <button
                type="button"
                onClick={() => setFormat("individual_ladder")}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${format === "individual_ladder" ? "border-primary bg-primary/10" : "border-border bg-background/50 hover:border-border/80"}`}
              >
                <div className={`font-bold text-sm display-font tracking-wide mb-1 ${format === "individual_ladder" ? "text-primary" : "text-foreground"}`}>INDIVIDUAL LADDER</div>
                <div className="text-xs text-muted-foreground">Players rotate partners every game. Winners move up, losers move down.</div>
              </button>
              <button
                type="button"
                onClick={() => setFormat("americano")}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${format === "americano" ? "border-primary bg-primary/10" : "border-border bg-background/50 hover:border-border/80"}`}
              >
                <div className={`font-bold text-sm display-font tracking-wide mb-1 ${format === "americano" ? "text-primary" : "text-foreground"}`}>AMERICANO SOCIAL</div>
                <div className="text-xs text-muted-foreground">Everyone rotates partners. Every point counts toward individual standings.</div>
              </button>
              <button
                type="button"
                onClick={() => setFormat("team_event")}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${format === "team_event" ? "border-primary bg-primary/10" : "border-border bg-background/50 hover:border-border/80"}`}
              >
                <div className={`font-bold text-sm display-font tracking-wide mb-1 ${format === "team_event" ? "text-primary" : "text-foreground"}`}>TEAM EVENT</div>
                <div className="text-xs text-muted-foreground">Teams play ties (rubbers) against each other. Lineups, substitutions, and crossovers.</div>
              </button>
            </div>
          </div>

          {!isIndividualFormat && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Number of Groups</label>
                <Input
                  type="number" min={1} max={26}
                  value={groupCount}
                  onChange={(e) => setGroupCount(Math.max(1, Number(e.target.value)))}
                  className="bg-background border-border text-foreground text-lg h-12"
                />
                <p className="text-xs text-muted-foreground">Groups labelled A, B, C…</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Teams per Group</label>
                <Input
                  type="number" min={2} max={20}
                  value={teamsPerGroup}
                  onChange={(e) => setTeamsPerGroup(Math.max(2, Number(e.target.value)))}
                  className="bg-background border-border text-foreground text-lg h-12"
                />
                <p className="text-xs text-muted-foreground">Each team plays every other once</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Number of Courts</label>
                <Input
                  type="number" min={1} max={20}
                  value={courtCount}
                  onChange={(e) => setCourtCount(Math.max(1, Number(e.target.value)))}
                  className="bg-background border-border text-foreground text-lg h-12"
                />
                <p className="text-xs text-muted-foreground">Courts assigned per round</p>
              </div>
            </div>
          )}

          {isIndividualFormat && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Number of Courts</label>
                <Input
                  type="number" min={format === "americano" ? 1 : 2} max={3}
                  value={courtCount}
                  onChange={(e) => setCourtCount(Math.max(format === "americano" ? 1 : 2, Math.min(3, Number(e.target.value))))}
                  className="bg-background border-border text-foreground text-lg h-12"
                  data-testid="input-ladder-court-count"
                />
                <p className="text-xs text-muted-foreground">{format === "americano" ? "Choose 1, 2, or 3 courts." : "Choose 2 or 3 courts for the ladder."}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Seeded Player List</label>
                <textarea
                  value={ladderParticipantsStr}
                  onChange={(e) => setLadderParticipantsStr(e.target.value)}
                  placeholder="Top player&#10;Next player&#10;…&#10;Bottom player"
                  className="w-full bg-background border border-border rounded-md text-foreground p-3 min-h-[120px]"
                  data-testid="input-ladder-participants"
                />
                <p className={`text-xs ${ladderStartReady ? "text-green-400" : "text-muted-foreground"}`}>
                   Enter names only: the first line automatically becomes seed #1, and each line below is the next seed. {ladderNames.length} players listed. {format === "americano" ? `Americano needs exactly ${ladderMinimumPlayers} available players.` : `Start needs at least ${ladderMinimumPlayers} players and an even total.`}
                </p>
                {ladderNames.length > 0 && (
                  <div className="max-h-28 overflow-y-auto rounded-md border border-border bg-background/50 divide-y divide-border/50">
                    {ladderNames.map((player, index) => (
                      <div key={`${player}-${index}`} className="flex gap-2 px-3 py-1.5 text-xs">
                        <span className="w-8 font-bold mono-font text-primary">#{index + 1}</span>
                        <span className="truncate text-foreground">{player}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}


          {format === "team_event" && (
            <div className="space-y-6 bg-background/50 border border-border p-4 rounded-md">
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-foreground uppercase tracking-wider">Team Roster Requirements</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground">Min Men</label>
                    <Input
                      type="number" min={0}
                      value={minMen}
                      onChange={(e) => setMinMen(Math.max(0, Number(e.target.value)))}
                      className="bg-background border-border"
                      data-testid="input-min-men"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Min Women</label>
                    <Input
                      type="number" min={0}
                      value={minWomen}
                      onChange={(e) => setMinWomen(Math.max(0, Number(e.target.value)))}
                      className="bg-background border-border"
                      data-testid="input-min-women"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-medium text-foreground uppercase tracking-wider">Tie Format (Rubbers)</h3>
                  <Button
                    type="button" variant="outline" size="sm"
                    data-testid="button-add-rubber"
                    onClick={() => {
                      const newT = [...teamEventTemplates, {
                        stage: "group" as any, order: teamEventTemplates.length + 1, matchType: "mens_singles" as any, targetPoints: 21 as any, bestOf: 3 as any
                      }];
                      // re-order
                      newT.filter(t => t.stage === "group").forEach((t, i) => t.order = i + 1);
                      newT.filter(t => t.stage === "knockout").forEach((t, i) => t.order = i + 1);
                      setTeamEventTemplates(newT);
                    }}
                  >
                    Add Rubber
                  </Button>
                </div>

                {(() => {
                  const knockoutCount = teamEventTemplates.filter(t => t.stage === 'knockout').length;
                   if (knockoutCount > 0 && knockoutCount % 2 === 0 && !dreambreakerEnabled) {
                    return (
                      <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 p-2 rounded">
                        Knockout ties have an even number of rubbers ({knockoutCount}). Enable Dreambreaker or add/remove a rubber.
                      </div>
                    );
                  }
                  return null;
                })()}

                <div className="space-y-2">
                  {teamEventTemplates.map((template, idx) => (
                    <div key={idx} className="flex flex-col gap-2 bg-card border border-border p-2 rounded">
                      <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
                        <span className="text-xs font-bold w-4 text-center text-muted-foreground">{template.order}</span>
                        <select
                          className="bg-background border border-border rounded text-xs p-1 font-semibold text-primary"
                          value={template.stage}
                          onChange={(e) => {
                            const newT = [...teamEventTemplates];
                            newT[idx].stage = e.target.value as any;
                            // re-order
                            newT.filter(t => t.stage === "group").forEach((t, i) => t.order = i + 1);
                            newT.filter(t => t.stage === "knockout").forEach((t, i) => t.order = i + 1);
                            setTeamEventTemplates(newT);
                          }}
                          data-testid={`select-rubber-stage-${idx}`}
                        >
                          <option value="group">Group</option>
                          <option value="knockout">Knockout</option>
                        </select>
                        <select
                          className="bg-background border border-border rounded text-xs p-1"
                          value={template.matchType}
                          onChange={(e) => {
                            const newT = [...teamEventTemplates];
                            newT[idx].matchType = e.target.value as any;
                            if (e.target.value !== "mixed_doubles") {
                              delete newT[idx].disallowSameMaleFromPreviousMixed;
                            }
                            setTeamEventTemplates(newT);
                          }}
                          data-testid={`select-rubber-matchType-${idx}`}
                        >
                          <option value="mens_singles">Men's Singles</option>
                          <option value="womens_singles">Women's Singles</option>
                          <option value="mens_doubles">Men's Doubles</option>
                          <option value="womens_doubles">Women's Doubles</option>
                          <option value="mixed_doubles">Mixed Doubles</option>
                        </select>
                        <select
                          className="bg-background border border-border rounded text-xs p-1"
                          value={template.bestOf}
                          onChange={(e) => {
                            const newT = [...teamEventTemplates];
                            newT[idx].bestOf = Number(e.target.value) as any;
                            setTeamEventTemplates(newT);
                          }}
                        >
                          <option value={1}>Best of 1</option>
                          <option value={3}>Best of 3</option>
                        </select>
                        <select
                          className="bg-background border border-border rounded text-xs p-1"
                          value={template.targetPoints}
                          onChange={(e) => {
                            const newT = [...teamEventTemplates];
                            newT[idx].targetPoints = Number(e.target.value) as any;
                            setTeamEventTemplates(newT);
                          }}
                        >
                          <option value={15}>15 Points</option>
                          <option value={21}>21 Points</option>
                        </select>

                        <div className="flex-1 flex justify-end">
                          <Button
                            type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                            onClick={() => {
                              const newT = [...teamEventTemplates];
                              newT.splice(idx, 1);
                              newT.filter(t => t.stage === "group").forEach((t, i) => t.order = i + 1);
                              newT.filter(t => t.stage === "knockout").forEach((t, i) => t.order = i + 1);
                              setTeamEventTemplates(newT);
                            }}
                            data-testid={`button-remove-rubber-${idx}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {template.matchType === "mixed_doubles" && (
                        <div className="flex items-center gap-2 pl-6">
                          <input
                            type="checkbox"
                            checked={!!template.disallowSameMaleFromPreviousMixed}
                            onChange={(e) => {
                              const newT = [...teamEventTemplates];
                              newT[idx].disallowSameMaleFromPreviousMixed = e.target.checked;
                              setTeamEventTemplates(newT);
                            }}
                            id={`disallow-male-${idx}`}
                            className="rounded border-border bg-background"
                          />
                          <label htmlFor={`disallow-male-${idx}`} className="text-[10px] text-muted-foreground uppercase tracking-wider cursor-pointer">
                            Disallow male player from playing multiple mixed doubles
                          </label>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <label className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
                  <input
                    type="checkbox"
                    checked={dreambreakerEnabled}
                    onChange={(event) => setDreambreakerEnabled(event.target.checked)}
                    className="mt-1 rounded border-border bg-background"
                    data-testid="checkbox-dreambreaker"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-foreground">Enable knockout Dreambreaker</span>
                    <span className="block text-xs text-muted-foreground">
                      If regulation rubbers finish tied, each team submits an ordered rotation of two named men and two named women. Singles rotate every four rallies and play to 21, win by two.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {(format === "group_knockout" || format === "team_event") && (
            <label className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
              <input
                type="checkbox"
                checked={thirdPlacePlayoffEnabled}
                onChange={(event) => setThirdPlacePlayoffEnabled(event.target.checked)}
                className="mt-1 rounded border-border bg-background"
                data-testid="checkbox-third-place-playoff"
              />
              <span>
                 <span className="block text-sm font-semibold text-foreground">Play a bronze-medal match</span>
                <span className="block text-xs text-muted-foreground">
                  Semifinal losers play for third and fourth place. Turn this off to end with only the final.
                </span>
              </span>
            </label>
          )}


          {/* Qualifiers per group — only shown for group→knockout */}
          {usesQualifiers && breakoutOn && (
            <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm" data-testid="text-breakout-overrides-legacy">
              <span className="font-semibold text-primary">Breakout knockouts are enabled.</span>{" "}
              <span className="text-muted-foreground">The qualifier, wildcard and tiebreaker rules below decide who qualifies. Qualifiers are then sent to the breakout bracket that owns their group (2 to 64 per bracket). Both breakouts share the knockout format below: single elimination, or a Top 6 Playoff that needs exactly six qualifiers in each bracket.</span>
            </div>
          )}
          {usesQualifiers && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Qualifiers per Group</label>
                <div className="flex items-center gap-4">
                  <Input
                    type="number" min={1} max={teamsPerGroup}
                    value={qualifiersPerGroup}
                    onChange={(e) => {
                      const next = Math.max(1, Math.min(teamsPerGroup, Number(e.target.value)));
                      setQualifiersPerGroup(next);
                      setWildcardQualifiers((current) => Math.min(current, Math.max(0, totalTeams - groupCount * next)));
                    }}
                    className="bg-background border-border text-foreground text-lg h-12 w-32"
                  />
                  <div className="text-sm text-muted-foreground">
                    <span className="mono-font text-foreground font-semibold">{groupCount} × {qualifiersPerGroup} + {wildcardQualifiers} = {totalQualifiers} teams</span>
                    {" → "}
                    <span className={`font-bold ${!qualifierCountValid ? "text-destructive" : "text-primary"}`}>
                      {!breakoutOn && effectiveKnockoutFormat === "top6"
                        ? (totalQualifiers === 6 ? "Top 6 Playoff" : `Top 6 Playoff needs exactly 6, not ${totalQualifiers}`)
                        : breakoutOn
                        ? (qualifierCountValid ? "split across two breakout brackets by group" : `need ${minQualifiers}–${maxQualifiers} across both brackets`)
                        : bracketRoundName(totalQualifiers)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Input
                    type="number"
                    min={0}
                    max={maxWildcardQualifiers}
                    value={wildcardQualifiers}
                    onChange={(e) => setWildcardQualifiers(Math.max(0, Math.min(maxWildcardQualifiers, Number(e.target.value))))}
                    className="bg-background border-border text-foreground text-lg h-12 w-32"
                    data-testid="input-wildcard-qualifiers"
                  />
                  <div className="text-sm text-muted-foreground">
                    Additional teams across all groups (0–{maxWildcardQualifiers})
                  </div>
                </div>
                {wildcardQualifiers > 0 && (
                  <fieldset className="space-y-3 rounded-md border border-border bg-background/40 p-3">
                    <legend className="px-1 text-sm font-medium text-foreground">How to choose additional qualifiers</legend>
                    <label className="flex items-start gap-2 text-sm text-foreground">
                      <input type="radio" name="wildcard-selection" checked={wildcardSelectionMethod === "ranking"} onChange={() => setWildcardSelectionMethod("ranking")} className="mt-1 accent-primary" />
                      <span><strong>Compare group standings</strong><span className="block text-xs text-muted-foreground">Rank teams at the same finishing position across groups.</span></span>
                    </label>
                    {wildcardSelectionMethod === "ranking" && (
                      <div className="pl-5 space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:gap-5">
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            <input type="radio" name="wildcard-ranking" value="points" checked={wildcardRankingMethod === "points"} onChange={() => setWildcardRankingMethod("points")} className="accent-primary" />
                            Total points
                          </label>
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            <input type="radio" name="wildcard-ranking" value="ppg" checked={wildcardRankingMethod === "ppg"} onChange={() => setWildcardRankingMethod("ppg")} className="accent-primary" data-testid="radio-wildcard-ppg" />
                            Points per game (PPG)
                          </label>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {wildcardRankingMethod === "ppg"
                            ? "PPG = points ÷ games played. Use this when groups play different numbers of games. Equal PPG uses per-game standings tiebreakers."
                            : "Uses total points, then the configured standings tiebreakers within each finishing position."}
                        </p>
                      </div>
                    )}
                    <label className={`flex items-start gap-2 text-sm ${groupCount === 3 && qualifiersPerGroup === 2 && wildcardQualifiers === 2 ? "text-foreground" : "text-muted-foreground"}`}>
                      <input type="radio" name="wildcard-selection" checked={wildcardSelectionMethod === "round_robin"} disabled={groupCount !== 3 || teamsPerGroup < 3 || qualifiersPerGroup !== 2 || wildcardQualifiers !== 2} onChange={() => setWildcardSelectionMethod("round_robin")} className="mt-1 accent-primary" />
                      <span><strong>Three-team qualifier playoff</strong><span className="block text-xs text-muted-foreground">Each third-place team plays the other two once. The top two reach the knockout. Available with three groups of at least three teams, two qualifiers per group and two additional places. Start and score it in Matches after group play.</span></span>
                    </label>
                    <p className="text-xs text-muted-foreground">You can also choose knockout teams manually in Matches when needed.</p>
                    {knockoutMatches.length > 0 && <p className="text-xs text-orange-400">An existing knockout draw will not be changed by this setting.</p>}
                  </fieldset>
                )}
              </div>

              {/* Knockout format selector — shared by both breakout brackets when enabled */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Knockout Stage Format{breakoutOn ? " · both breakouts" : ""}</label>
                <div className={`grid gap-3 ${breakoutOn ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
                  {([
                    ["single", "SINGLE ELIMINATION", "One loss and you're out. Qualifiers fill a power-of-two draw with byes where needed."],
                    ...(breakoutOn ? [] : [["double", "DOUBLE ELIMINATION", "Two losses to be eliminated. Losers drop to the Loser Bracket. Grand Final reset if needed."]]),
                    ["top6", "TOP 6 PLAYOFF", breakoutOn ? "Exactly six qualifiers per bracket. Seeds 1 and 2 skip to the semifinals; 3 v 6 and 4 v 5 play quarterfinals." : "Exactly six qualifiers. Seeds 1 and 2 skip to the semifinals; 3 v 6 and 4 v 5 play quarterfinals."],
                  ] as [KnockoutMode, string, string][]).map(([value, title, desc]) => {
                    const active = effectiveKnockoutFormat === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={knockoutModeLocked}
                        onClick={() => setKnockoutFormat(value)}
                        className={`p-4 rounded-lg border-2 text-left transition-colors disabled:cursor-not-allowed ${active ? "border-primary bg-primary/10" : "border-border bg-background/50 hover:border-border/80"} ${knockoutModeLocked && !active ? "opacity-40" : ""}`}
                        data-testid={`button-knockout-format-${value}`}
                      >
                        <div className={`font-bold text-sm display-font tracking-wide mb-1 ${active ? "text-primary" : "text-foreground"}`}>{title}</div>
                        <div className="text-xs text-muted-foreground">{desc}</div>
                      </button>
                    );
                  })}
                </div>
                {knockoutModeLocked && (
                  <p className="text-xs text-orange-400" data-testid="text-knockout-format-locked">A knockout draw already exists, so the format is locked. Reset the draw from Matches to change it. Results are never cleared automatically.</p>
                )}
                {effectiveKnockoutFormat === "top6" && (
                  <>
                    <Top6Info compact={false} label={breakoutOn ? "each breakout bracket" : undefined} />
                    {breakoutOn ? (
                      <p className="text-xs text-muted-foreground">Each bracket must end up with exactly six qualifiers under the rules above. Teams are never added or dropped to reach six; Matches shows whether each bracket is ready.</p>
                    ) : totalQualifiers !== 6 ? (
                      <p className="text-xs text-destructive" data-testid="text-top6-count-invalid">The qualifier rules currently produce {totalQualifiers} teams. Top 6 needs exactly 6.</p>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )}

          {!isIndividualFormat && (
            <div className="bg-background/50 border border-border rounded-md p-4">
              <div className="grid grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold mono-font text-foreground">{groupCount}</div>
                  <div className="uppercase text-xs text-muted-foreground mt-1">Groups</div>
                </div>
                <div>
                  <div className="text-2xl font-bold mono-font text-foreground">{totalTeams}</div>
                  <div className="uppercase text-xs text-muted-foreground mt-1">Total Teams</div>
                </div>
                <div>
                  <div className="text-2xl font-bold mono-font text-foreground">{totalMatches}</div>
                  <div className="uppercase text-xs text-muted-foreground mt-1">Total Matches</div>
                </div>
                <div>
                  <div className="text-2xl font-bold mono-font text-foreground">{roundsPerGroup}</div>
                  <div className="uppercase text-xs text-muted-foreground mt-1">Rounds</div>
                </div>
              </div>
            </div>
          )}

          {/* Tiebreaker Priority */}
          {!isIndividualFormat ? (
            <div className="space-y-3">
              <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Tiebreaker Priority</label>
              <p className="text-xs text-muted-foreground">When teams are level on points, apply these tiebreakers in order (drag or use arrows to reorder).</p>
              <div className="space-y-1.5">
                {tiebreakerOrder.map((key, idx) => (
                  <div key={key} className="flex items-center gap-2 bg-background/50 border border-border rounded-md px-3 py-2">
                    <span className="text-xs font-bold text-primary mono-font w-5 shrink-0">{idx + 1}.</span>
                    <span className="flex-1 text-sm text-foreground">{TIEBREAKER_LABELS[key] ?? key}</span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => moveTiebreaker(idx, -1)}
                        disabled={idx === 0}
                      >
                        <ChevronUp className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => moveTiebreaker(idx, 1)}
                        disabled={idx === tiebreakerOrder.length - 1}
                      >
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-4 items-center">
            <Button
              onClick={handleSave}
              disabled={updateTournament.isPending || !qualifierCountValid}
              title={!qualifierCountValid ? `Adjust qualifiers: ${totalQualifiers < minQualifiers ? `need at least ${minQualifiers}` : `max is ${maxQualifiers}`}` : undefined}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider"
              data-testid="button-save-tournament-settings"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Settings
            </Button>
            {!isIndividualFormat && (
              confirmGenerate ? (
                <>
                  <span className="text-xs text-orange-400 font-semibold">
                    {breakoutGenerated || breakoutConfigured
                      ? `This will permanently erase BOTH breakout knockout brackets${breakoutGenerated ? " and all their results and champions" : ""}, the breakout setup (names and group assignments), all custom group names, and regenerate all groups, teams, and matches. Continue?`
                      : "This will erase the knockout bracket, any third-place qualifier playoff and its scores, and regenerate all groups, teams, and matches. Continue?"}
                  </span>
                  <Button
                    onClick={handleGenerate}
                    disabled={generateTournament.isPending || updateTournament.isPending}
                    variant="outline"
                    className="border-destructive text-destructive hover:bg-destructive/10 font-bold uppercase tracking-wider"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${generateTournament.isPending ? "animate-spin" : ""}`} />
                    Yes, Regenerate
                  </Button>
                  <Button
                    variant="ghost"
                    className="font-bold uppercase tracking-wider text-sm"
                    onClick={() => setConfirmGenerate(false)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    onClick={handleGenerate}
                    disabled={generateTournament.isPending || updateTournament.isPending || !qualifierCountValid || knockoutUncertain}
                    title={knockoutUncertain ? "Loading bracket data…" : undefined}
                    variant="outline"
                    className="border-orange-500 text-orange-400 hover:bg-orange-500/10 font-bold uppercase tracking-wider"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${generateTournament.isPending ? "animate-spin" : ""}`} />
                    Generate Tournament
                  </Button>
                </>
              )
            )}
            {tournament?.status === "completed" && (
              <Button
                onClick={() => reopenTournament.mutate({ id: tournamentId })}
                disabled={reopenTournament.isPending}
                variant="outline"
                className="border-blue-500 text-blue-400 hover:bg-blue-500/10 font-bold uppercase tracking-wider"
              >
                <RotateCcw className={`w-4 h-4 mr-2 ${reopenTournament.isPending ? "animate-spin" : ""}`} />
                Reopen Tournament
              </Button>
            )}
          </div>
          {!isIndividualFormat && (
            <p className="text-xs text-muted-foreground">
              Warning: Generating resets all groups, teams, and matches for this tournament. Matches are scheduled so every team has equal rest between games.
            </p>
          )}
        </CardContent>
      </Card>

      {tournament && isGroupBasedFormat(tournament.format) && (groups?.length ?? 0) > 0 && (
        <>
          <GroupNamesEditor tournamentId={tournamentId} groups={groups ?? []} />
          <BreakoutConfigCard tournamentId={tournamentId} groups={groups ?? []} format={tournament.format} />
        </>
      )}
      {tournament && !isGroupBasedFormat(tournament.format) && tournament.format === "team_event" && (groups?.length ?? 0) > 0 && (
        <GroupNamesEditor tournamentId={tournamentId} groups={groups ?? []} />
      )}

      {canManageOrganizers && (
        <Card className="bg-card border border-border">
          <CardHeader>
            <CardTitle className="display-font text-xl tracking-wide text-primary">CO-ORGANIZERS</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Co-organizers can manage this tournament — enter scores, rename teams, and update settings. Only accounts that have already signed in can be added.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add co-organizer */}
            <div className="flex gap-2">
              <Input
                value={coOrgEmail}
                onChange={(e) => setCoOrgEmail(e.target.value)}
                placeholder="email@example.com"
                type="email"
                className="bg-background border-border text-foreground h-10"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && coOrgEmail.trim()) {
                    addCoOrganizer.mutate({ id: tournamentId, data: { email: coOrgEmail.trim() } });
                  }
                }}
              />
              <Button
                onClick={() => addCoOrganizer.mutate({ id: tournamentId, data: { email: coOrgEmail.trim() } })}
                disabled={!coOrgEmail.trim() || addCoOrganizer.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider shrink-0"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Add
              </Button>
            </div>

            {/* Current co-organizers */}
            {!coOrganizers || coOrganizers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No co-organizers yet. Add someone above to share access.</p>
            ) : (
              <div className="space-y-1">
                {coOrganizers.map((co) => (
                  <div key={co.userId} className="flex items-center gap-3 px-3 py-2 bg-background/50 border border-border rounded-md">
                    <span className="flex-1 text-sm text-foreground">{co.email}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => removeCoOrganizer.mutate({ id: tournamentId, userId: co.userId })}
                      disabled={removeCoOrganizer.isPending}
                      title="Remove co-organizer"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isIndividualFormat && groups && groups.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-2xl font-bold display-font text-foreground tracking-wide">RENAME TEAMS</h3>
          <p className="text-sm text-muted-foreground">Hover over any team name and click the pencil to rename it.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {groups.map((group) => {
              const groupTeams = teams?.filter((t) => t.groupId === group.id) ?? [];
              return (
                <Card key={group.id} className="bg-card border border-border">
                  <div className="bg-muted/50 px-4 py-2 border-b border-border">
                    <span className="font-bold display-font text-lg tracking-wide text-primary">{group.name}</span>
                  </div>
                  <CardContent className="p-4 space-y-1">
                    {groupTeams.map((team) => (
                      <div key={team.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/20 group">
                        {editingTeam?.id === team.id ? (
                          <>
                            <Input
                              value={editingTeam.name}
                              onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
                              className="flex-1 h-8 bg-background border-border text-sm"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveTeam(team.id, team.groupId);
                                if (e.key === "Escape") setEditingTeam(null);
                              }}
                            />
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-green-400 hover:text-green-300" onClick={() => handleSaveTeam(team.id, team.groupId)}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingTeam(null)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-sm font-medium text-foreground">{team.name}</span>
                            <Button
                              size="icon" variant="ghost"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                              onClick={() => setEditingTeam({ id: team.id, name: team.name })}
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                    {groupTeams.length === 0 && (
                      <p className="text-xs text-muted-foreground py-2">No teams in this group.</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
