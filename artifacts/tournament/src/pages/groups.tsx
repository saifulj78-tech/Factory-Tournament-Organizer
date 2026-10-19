import { useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTournamentById,
  useListTournamentGroups,
  useListTournamentTeams,
  useListTournamentMatches,
  useListKnockoutMatches,
  useGetTeamEventState,
  getGetTeamEventStateQueryKey,
  useReplaceTeamEventRoster,
  type TeamEventRosterInputPlayersItem,
  type TeamEventPlayerGender,
  useCreateTournamentTeam,
  useUpdateTeam,
  useDeleteTeam,
  useReplaceAndDeleteTeam,
  useRandomizeTeams,
  getListTournamentTeamsQueryKey,
  getListTournamentMatchesQueryKey,
  getListKnockoutMatchesQueryKey,
  getListTournamentStandingsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit2, Trash2, Check, X, Shuffle, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function Groups() {
  const { id } = useParams<{ id: string }>();
  const tournamentId = Number(id);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: tournament, isLoading: isLoadingTournament } = useGetTournamentById(tournamentId);
  const { data: groups, isLoading: isLoadingGroups } = useListTournamentGroups(tournamentId);
  const { data: teams, isLoading: isLoadingTeams } = useListTournamentTeams(tournamentId);
  const { data: fixtures, isLoading: isLoadingFixtures } = useListTournamentMatches(tournamentId);
  const hasKnockout = tournament?.format === "group_knockout" || tournament?.format === "team_event";
  const { data: knockoutFixtures, isLoading: isLoadingKnockout } = useListKnockoutMatches(tournamentId, {
    query: { queryKey: getListKnockoutMatchesQueryKey(tournamentId), enabled: hasKnockout },
  });

  const isTeamEvent = tournament?.format === "team_event";
  const { data: teamEventState } = useGetTeamEventState(tournamentId, {
    query: {
      queryKey: getGetTeamEventStateQueryKey(tournamentId),
      enabled: isTeamEvent,
    },
  });

  const replaceRoster = useReplaceTeamEventRoster({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTeamEventStateQueryKey(tournamentId) });
        setRosterTeamId(null);
        toast({ title: "Roster saved" });
      },
      onError: (e: any) => toast({ title: "Error", description: e?.response?.data?.error || "Failed to save roster.", variant: "destructive" }),
    },
  });

  const [rosterTeamId, setRosterTeamId] = useState<number | null>(null);
  const [rosterPlayers, setRosterPlayers] = useState<TeamEventRosterInputPlayersItem[]>([]);

  const handleOpenRoster = (teamId: number) => {
    const existing = teamEventState?.rosters?.[teamId] || [];
    setRosterPlayers(existing.map(p => ({ name: p.name, gender: p.gender as TeamEventPlayerGender })));
    setRosterTeamId(teamId);
  };

  const handleSaveRoster = () => {
    if (!rosterTeamId) return;
    replaceRoster.mutate({ id: rosterTeamId, data: { players: rosterPlayers.filter(p => p.name.trim()) } });
  };

  const [editingTeam, setEditingTeam] = useState<{ id: number; name: string; groupId: number } | null>(null);
  const [addingToGroup, setAddingToGroup] = useState<{ groupId: number; name: string } | null>(null);
  const [teamToDelete, setTeamToDelete] = useState<{ id: number; name: string; groupId: number } | null>(null);
  const [replacementTeamId, setReplacementTeamId] = useState("");
  const affectedFixtures = fixtures?.filter(m => m.homeTeamId === teamToDelete?.id || m.awayTeamId === teamToDelete?.id) ?? [];
  const affectedKnockout = knockoutFixtures?.filter(m => m.homeTeamId === teamToDelete?.id || m.awayTeamId === teamToDelete?.id || m.winnerId === teamToDelete?.id) ?? [];
  const needsReplacement = affectedFixtures.length > 0 || affectedKnockout.length > 0;
  const scoredFixtures = affectedFixtures.filter(m => m.played || m.homeScore != null || m.awayScore != null).length;
  const scoredKnockout = affectedKnockout.some(m => m.played || m.winnerId != null || m.homeScore != null || m.awayScore != null);
  const isDoubleElim = knockoutFixtures?.some(m => m.bracket === "winner");
  const unsafeReplace = scoredKnockout && isDoubleElim;
  const unsafeRemove = isDoubleElim && affectedKnockout.length > 0 &&
    knockoutFixtures?.some(m => m.played || m.winnerId != null || m.homeScore != null || m.awayScore != null);

  // Bulk import state
  const [bulkText, setBulkText] = useState("");
  const [showBulk, setShowBulk] = useState(false);

  const parsedNames = bulkText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const groupCount = groups?.length ?? 0;
  const teamsPerGroup = tournament?.teamsPerGroup ?? 0;
  const expectedTotal = groupCount * teamsPerGroup;

  const createTeam = useCreateTournamentTeam({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTournamentTeamsQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentMatchesQueryKey(tournamentId) });
        setAddingToGroup(null);
      },
      onError: () => toast({ title: "Error", description: "Failed to add team.", variant: "destructive" }),
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

  const deleteTeam = useDeleteTeam({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTournamentTeamsQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentStandingsQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getGetTeamEventStateQueryKey(tournamentId) });
        setTeamToDelete(null);
        setReplacementTeamId("");
        toast({ title: "Organizers: fixtures changed", description: "Team and its fixtures removed. Check the updated schedule and knockout bracket." });
      },
      onError: (e: any) => toast({ title: "Team not deleted", description: e?.data?.error || e?.message || "Failed to delete team.", variant: "destructive" }),
    },
  });

  const replaceTeam = useReplaceAndDeleteTeam({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListTournamentTeamsQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentStandingsQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getGetTeamEventStateQueryKey(tournamentId) });
        setTeamToDelete(null);
        setReplacementTeamId("");
        toast({ title: "Organizers: fixtures changed", description: `${result.groupFixturesChanged} group and ${result.knockoutFixturesChanged} knockout fixture(s) updated; ${result.scoresCleared} group result(s) cleared.` });
      },
      onError: (e: any) => toast({ title: "Team not replaced", description: e?.data?.error || e?.message || "Failed to replace team.", variant: "destructive" }),
    },
  });

  const randomizeTeams = useRandomizeTeams({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTournamentTeamsQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentMatchesQueryKey(tournamentId) });
        queryClient.invalidateQueries({ queryKey: getListTournamentStandingsQueryKey(tournamentId) });
        setBulkText("");
        setShowBulk(false);
        toast({ title: "Teams randomized!", description: `${parsedNames.length} teams shuffled into ${groupCount} groups.` });
      },
      onError: () => toast({ title: "Error", description: "Failed to randomize teams.", variant: "destructive" }),
    },
  });

  const handleRandomize = () => {
    if (parsedNames.length < 2) return;
    randomizeTeams.mutate({ id: tournamentId, data: { teamNames: parsedNames } });
  };

  const isLoading = isLoadingGroups || isLoadingTeams;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64 bg-card" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48 bg-card" />)}
        </div>
      </div>
    );
  }

  const hasGroups = groups && groups.length > 0;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-4xl font-bold display-font text-foreground tracking-wide">GROUPS & TEAMS</h2>
          <p className="text-muted-foreground mt-1">
            {isTeamEvent
              ? "Manage teams and enter each team's player roster"
              : "Manage teams within each group"}
          </p>
        </div>
        {hasGroups && (
          <Button
            variant="outline"
            className="border-primary/40 text-primary hover:bg-primary/10 gap-2"
            onClick={() => setShowBulk((v) => !v)}
          >
            <Shuffle className="h-4 w-4" />
            {showBulk ? "Hide Bulk Import" : "Bulk Import & Randomize"}
          </Button>
        )}
      </div>

      {/* ── Bulk import panel ── */}
      {showBulk && hasGroups && (
        <Card className="bg-card border border-primary/30">
          <CardContent className="p-5 space-y-4">
            <div>
              <p className="font-semibold text-foreground mb-1">Paste team names — one per line</p>
              <p className="text-sm text-muted-foreground">
                They will be shuffled randomly and distributed across {groupCount} group{groupCount !== 1 ? "s" : ""}.
                {expectedTotal > 0 && (
                  <span className="ml-1">
                    This tournament expects <span className="text-foreground font-medium">{expectedTotal} teams</span> total ({teamsPerGroup} per group).
                  </span>
                )}
              </p>
            </div>

            <Textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"Team Alpha\nTeam Bravo\nTeam Charlie\n..."}
              rows={8}
              className="bg-background border-border text-sm font-mono resize-y"
            />

            {parsedNames.length > 0 && (
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span className="text-muted-foreground">
                  <span className="text-foreground font-medium">{parsedNames.length}</span> team{parsedNames.length !== 1 ? "s" : ""} entered
                </span>
                {groupCount > 0 && (
                  <span className="text-muted-foreground">→</span>
                )}
                {groupCount > 0 && parsedNames.length > 0 && (
                  <span className="text-muted-foreground">
                    ≈ <span className="text-foreground font-medium">{Math.ceil(parsedNames.length / groupCount)}</span> per group
                  </span>
                )}
                {expectedTotal > 0 && parsedNames.length !== expectedTotal && (
                  <span className="text-yellow-500">
                    ⚠ Tournament is set up for {expectedTotal} teams — {parsedNames.length > expectedTotal ? "extra teams will fill groups unevenly" : "some group slots will be empty"}
                  </span>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                onClick={handleRandomize}
                disabled={parsedNames.length < 2 || randomizeTeams.isPending}
                className="bg-primary hover:bg-primary/90 gap-2"
              >
                <Shuffle className="h-4 w-4" />
                {randomizeTeams.isPending ? "Randomizing…" : "Randomize into Groups"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => { setBulkText(""); setShowBulk(false); }}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              ⚠ This replaces all existing teams and regenerates the match schedule.
            </p>
          </CardContent>
        </Card>
      )}

      {!hasGroups && (
        <div className="py-20 text-center border-2 border-dashed border-border rounded-lg">
          <p className="text-muted-foreground mb-4">No groups have been generated yet.</p>
          <a href={`/tournaments/${tournamentId}/settings`} className="text-primary hover:underline font-medium">Go to Tournament Setup to generate groups</a>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {groups?.map((group) => {
          const groupTeams = teams?.filter((t) => t.groupId === group.id) ?? [];
          const isAddingHere = addingToGroup?.groupId === group.id;

          return (
            <Card key={group.id} className="bg-card border border-border overflow-hidden">
              <div className="bg-muted/50 px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="font-bold display-font text-xl tracking-wide text-primary">{group.name}</span>
                <span className="text-sm text-muted-foreground mono-font">{groupTeams.length} teams</span>
              </div>
              <CardContent className="p-4 space-y-2">
                {groupTeams.map((team, idx) => {
                  const rosterCount = teamEventState?.rosters?.[team.id]?.length ?? 0;

                  return (
                  <div key={team.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-accent/30 transition-colors group">
                    <span className="text-xs mono-font text-muted-foreground w-4">{idx + 1}</span>
                    {editingTeam?.id === team.id ? (
                      <>
                        <Input
                          value={editingTeam.name}
                          onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
                          className="flex-1 h-7 bg-background border-border text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") updateTeam.mutate({ id: team.id, data: { name: editingTeam.name, groupId: team.groupId } });
                            if (e.key === "Escape") setEditingTeam(null);
                          }}
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-green-400 hover:text-green-300" onClick={() => updateTeam.mutate({ id: team.id, data: { name: editingTeam.name, groupId: team.groupId } })}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setEditingTeam(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm font-medium text-foreground">{team.name}</span>

                        {isTeamEvent && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 shrink-0 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
                            onClick={() => handleOpenRoster(team.id)}
                          >
                            <Users className="h-3.5 w-3.5 mr-1.5" />
                            Roster
                            <span className="ml-1.5 text-xs text-muted-foreground">({rosterCount})</span>
                          </Button>
                        )}

                        <Button
                          size="icon" variant="ghost"
                          className="h-7 w-7 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                          onClick={() => setEditingTeam({ id: team.id, name: team.name, groupId: team.groupId })}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          className="h-7 w-7 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80"
                          aria-label={`Delete or replace ${team.name}`}
                          onClick={() => { setTeamToDelete({ id: team.id, name: team.name, groupId: team.groupId }); setReplacementTeamId(""); }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                  );
                })}

                {isAddingHere ? (
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      value={addingToGroup.name}
                      onChange={(e) => setAddingToGroup({ groupId: group.id, name: e.target.value })}
                      placeholder="Team name..."
                      className="flex-1 h-8 bg-background border-border text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && addingToGroup.name.trim()) {
                          createTeam.mutate({ id: tournamentId, data: { name: addingToGroup.name.trim(), groupId: group.id } });
                        }
                        if (e.key === "Escape") setAddingToGroup(null);
                      }}
                    />
                    <Button
                      size="icon" variant="ghost"
                      className="h-8 w-8 text-green-400 hover:text-green-300"
                      disabled={!addingToGroup.name.trim()}
                      onClick={() => createTeam.mutate({ id: tournamentId, data: { name: addingToGroup.name.trim(), groupId: group.id } })}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setAddingToGroup(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-2 border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors"
                    onClick={() => setAddingToGroup({ groupId: group.id, name: "" })}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Team
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!teamToDelete} onOpenChange={(open) => { if (!open && !deleteTeam.isPending && !replaceTeam.isPending) setTeamToDelete(null); }}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="display-font tracking-wide text-primary">
              {needsReplacement ? "REMOVE OR REPLACE TEAM" : "DELETE TEAM"}
            </DialogTitle>
          </DialogHeader>
          {teamToDelete && (
            <div className="space-y-3 text-sm">
              {(isLoadingTournament || isLoadingFixtures || (hasKnockout && isLoadingKnockout)) ? (
                <p className="text-muted-foreground">Checking fixtures…</p>
              ) : needsReplacement ? (
                <>
                  <p>
                    <strong>{teamToDelete.name}</strong> appears in {affectedFixtures.length} group and {affectedKnockout.length} knockout fixture(s).
                    Removing without a replacement deletes their group fixtures and {scoredFixtures} group result(s).
                    Other group results stay unchanged. The knockout bracket will adjust its affected paths and award byes where appropriate.
                  </p>
                  <p className="text-muted-foreground">Alternatively, choose a replacement below. That keeps the fixtures, but clears their old scores and lineups so the new team does not inherit results. Connected organizers will be notified of either change.</p>
                  {isDoubleElim && affectedKnockout.length > 0 && !unsafeRemove && (
                    <p className="text-destructive" role="alert">
                      Without a replacement, the entire unscored double-elimination bracket will be removed. Generate it again after deleting this team.
                    </p>
                  )}
                  {(unsafeRemove || unsafeReplace) && (
                    <p className="text-destructive" role="alert">
                      {unsafeRemove
                        ? "The double-elimination bracket has recorded results, so removing this team without replacement is blocked to protect the other scores."
                        : "This team has scored double-elimination matches. Replacement is blocked until those results and advancement are safely reset."}
                    </p>
                  )}
                  {!unsafeReplace && (
                    <>
                    {scoredKnockout && <p className="text-destructive" role="alert">Knockout results involving this team and any results that depend on them will also be cleared.</p>}
                    <label className="block space-y-1">
                      <span className="font-semibold">Replacement team (same group)</span>
                      <select
                        value={replacementTeamId}
                        onChange={(event) => setReplacementTeamId(event.target.value)}
                        className="w-full rounded-md border border-border bg-background p-2 text-foreground"
                      >
                        <option value="">Choose a team</option>
                        {teams?.filter(team =>
                          team.groupId === teamToDelete.groupId &&
                          team.id !== teamToDelete.id &&
                          !affectedFixtures.some(m =>
                            m.homeTeamId === team.id || m.awayTeamId === team.id,
                          ) &&
                          !affectedKnockout.some(m => m.homeTeamId === team.id || m.awayTeamId === team.id),
                        ).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
                      </select>
                      <span className="block text-xs text-muted-foreground">
                        A team already playing against {teamToDelete.name} cannot replace it. If needed, add a reserve team to this group first.
                      </span>
                    </label>
                    </>
                  )}
                </>
              ) : (
                <p><strong>{teamToDelete.name}</strong> has no fixtures. Delete this team? This cannot be undone.</p>
              )}
            </div>
          )}
           <DialogFooter className="gap-2 sm:flex-wrap">
            <Button variant="ghost" onClick={() => setTeamToDelete(null)} disabled={deleteTeam.isPending || replaceTeam.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!teamToDelete || isLoadingTournament || isLoadingFixtures || (hasKnockout && isLoadingKnockout) ||
                deleteTeam.isPending || replaceTeam.isPending || unsafeRemove}
              onClick={() => {
                if (!teamToDelete) return;
                deleteTeam.mutate({ id: teamToDelete.id });
              }}
            >
              {needsReplacement ? "Remove team & fixtures" : "Delete team"}
            </Button>
            {needsReplacement && (
              <Button
                disabled={!teamToDelete || isLoadingTournament || isLoadingFixtures || (hasKnockout && isLoadingKnockout) ||
                  deleteTeam.isPending || replaceTeam.isPending || unsafeReplace || !replacementTeamId}
                onClick={() => {
                  if (teamToDelete && replacementTeamId) replaceTeam.mutate({ id: teamToDelete.id, data: { replacementTeamId: Number(replacementTeamId) } });
                }}
              >
                Replace & delete
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Roster Dialog */}
      <Dialog open={!!rosterTeamId} onOpenChange={(open) => !open && setRosterTeamId(null)}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="display-font tracking-wide text-primary">MANAGE ROSTER</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
            {rosterPlayers.map((player, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <Input
                  value={player.name}
                  onChange={(e) => {
                    const newR = [...rosterPlayers];
                    newR[idx].name = e.target.value;
                    setRosterPlayers(newR);
                  }}
                  placeholder="Player name..."
                  className="bg-background border-border text-sm"
                />
                <select
                  value={player.gender}
                  onChange={(e) => {
                    const newR = [...rosterPlayers];
                    newR[idx].gender = e.target.value as TeamEventPlayerGender;
                    setRosterPlayers(newR);
                  }}
                  className="bg-background border border-border rounded text-sm p-2 w-28"
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
                <Button
                  size="icon" variant="ghost" className="text-destructive h-8 w-8"
                  onClick={() => {
                    const newR = [...rosterPlayers];
                    newR.splice(idx, 1);
                    setRosterPlayers(newR);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              className="w-full border-dashed border-border"
              onClick={() => setRosterPlayers([...rosterPlayers, { name: "", gender: "male" }])}
            >
              <Plus className="w-4 h-4 mr-2" /> Add Player
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRosterTeamId(null)}>Cancel</Button>
            <Button onClick={handleSaveRoster} disabled={replaceRoster.isPending} className="bg-primary text-primary-foreground font-bold">
              Save Roster
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
