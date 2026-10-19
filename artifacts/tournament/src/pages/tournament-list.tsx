import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import {
  useListTournaments,
  useCreateTournament,
  useDeleteTournamentById,
  useCompleteTournament,
  useReopenTournament,
  useListTournamentStandings,
  getListTournamentsQueryKey,
  getListTournamentStandingsQueryKey,
} from "@workspace/api-client-react";
import type { Tournament } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Activity, Plus, Trash2, CheckCircle, ArrowRight, Trophy, Clock, ChevronDown, ChevronUp, LogOut, Users, Mail, UserMinus, Send, AlertCircle, UserCheck, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Organizer = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  expiresAt: string | null;
};

type OrphanedTournament = {
  id: number;
  name: string;
  status: string;
  createdAt: string;
};

function OrphanedTournamentsPanel({ organizers }: { organizers: Organizer[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [orphaned, setOrphaned] = useState<OrphanedTournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<Record<number, boolean>>({});
  const [selections, setSelections] = useState<Record<number, string>>({});

  const fetchOrphaned = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/tournaments/orphaned", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      setOrphaned(await res.json());
    } catch {
      toast({ title: "Error", description: "Failed to load orphaned tournaments.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchOrphaned(); }, [fetchOrphaned]);

  const handleAssign = async (tournamentId: number) => {
    const userId = selections[tournamentId];
    if (!userId) return;
    setAssigning((prev) => ({ ...prev, [tournamentId]: true }));
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}/assign-owner`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to assign owner");
      }
      toast({ title: "Owner assigned", description: "Tournament ownership updated." });
      setOrphaned((prev) => prev.filter((t) => t.id !== tournamentId));
      queryClient.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to assign owner";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setAssigning((prev) => ({ ...prev, [tournamentId]: false }));
    }
  };

  if (loading || orphaned.length === 0) return null;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <AlertCircle className="w-5 h-5 text-yellow-400" />
        <h3 className="text-xl font-bold display-font tracking-wide text-foreground">UNOWNED TOURNAMENTS</h3>
        <span className="text-sm text-muted-foreground mono-font">({orphaned.length})</span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        These tournaments have no owner (created before accounts were added). Assign each one to an organizer so they can manage it.
      </p>
      <div className="space-y-2">
        {orphaned.map((t) => (
          <Card key={t.id} className="bg-card border border-yellow-400/20">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground truncate">{t.name}</p>
                <p className="text-xs text-muted-foreground">Created {formatDate(t.createdAt)} · {t.status}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Select
                  value={selections[t.id] ?? ""}
                  onValueChange={(val) => setSelections((prev) => ({ ...prev, [t.id]: val }))}
                >
                  <SelectTrigger className="w-48 bg-background border-border text-foreground text-sm">
                    <SelectValue placeholder="Select organizer…" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizers.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.firstName || o.lastName ? `${o.firstName} ${o.lastName}`.trim() : o.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!selections[t.id] || assigning[t.id]}
                  onClick={() => handleAssign(t.id)}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider shrink-0"
                >
                  <UserCheck className="w-4 h-4 mr-1.5" />
                  {assigning[t.id] ? "Saving…" : "Assign"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function OrganizersPanel({
  organizers,
  loading,
  onOrganizersChange,
}: {
  organizers: Organizer[];
  loading: boolean;
  onOrganizersChange: (updater: (prev: Organizer[]) => Organizer[]) => void;
}) {
  const { toast } = useToast();
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [creating, setCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [editingExpiryId, setEditingExpiryId] = useState<string | null>(null);
  const [editingExpiryValue, setEditingExpiryValue] = useState("");
  const [savingExpiry, setSavingExpiry] = useState(false);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !newPassword) return;
    setCreating(true);
    try {
      const body: Record<string, string> = { email: newEmail.trim(), password: newPassword };
      if (newExpiry) body.expiresAt = new Date(newExpiry).toISOString();
      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create account");
      toast({ title: "Account created", description: `${newEmail.trim()} can now log in.` });
      onOrganizersChange((prev) => [
        ...prev,
        {
          id: data.id,
          email: data.email,
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
          createdAt: new Date(data.createdAt).toISOString(),
          expiresAt: newExpiry ? new Date(newExpiry).toISOString() : null,
        },
      ]);
      setNewEmail("");
      setNewPassword("");
      setNewExpiry("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create account";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleSaveExpiry = async (userId: string) => {
    setSavingExpiry(true);
    try {
      const expiresAt = editingExpiryValue ? new Date(editingExpiryValue).toISOString() : null;
      const res = await fetch(`/api/admin/organizers/${userId}/expiry`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresAt }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to update expiry");
      }
      onOrganizersChange((prev) =>
        prev.map((o) => o.id === userId ? { ...o, expiresAt: expiresAt } : o)
      );
      toast({ title: "Expiry updated" });
      setEditingExpiryId(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update expiry";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setSavingExpiry(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setRemovingId(userId);
    try {
      const res = await fetch(`/api/admin/organizers/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to remove");
      }
      toast({ title: "Organizer removed" });
      onOrganizersChange((prev) => prev.filter((o) => o.id !== userId));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to remove organizer";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setRemovingId(null);
      setConfirmRemoveId(null);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  const isExpired = (expiresAt: string | null) =>
    !!expiresAt && new Date(expiresAt) < new Date();

  const toDateInputValue = (iso: string | null) =>
    iso ? new Date(iso).toISOString().split("T")[0] : "";

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Users className="w-5 h-5 text-primary" />
        <h3 className="text-xl font-bold display-font tracking-wide text-foreground">ORGANIZERS</h3>
        <span className="text-sm text-muted-foreground mono-font">({organizers.length})</span>
      </div>

      {/* Create account form */}
      <Card className="bg-card border border-border mb-4">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5" />
            Create a login for someone — give them the email and password directly.
          </p>
          <form onSubmit={handleCreateUser} className="space-y-2">
            <Input
              type="email"
              placeholder="Email address"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="bg-background border-border text-foreground placeholder:text-muted-foreground"
              required
            />
            <div className="flex gap-2">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Password (min 8 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="flex-1 bg-background border-border text-foreground placeholder:text-muted-foreground"
                required
                minLength={8}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 border-border"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "Hide" : "Show"}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <label className="text-xs text-muted-foreground shrink-0">Access expires:</label>
              <Input
                type="date"
                value={newExpiry}
                onChange={(e) => setNewExpiry(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="flex-1 bg-background border-border text-foreground text-xs h-7 px-2"
              />
              {newExpiry && (
                <button type="button" onClick={() => setNewExpiry("")} className="text-xs text-muted-foreground hover:text-foreground shrink-0">Clear</button>
              )}
              {!newExpiry && <span className="text-xs text-muted-foreground italic">No expiry</span>}
            </div>
            <Button
              type="submit"
              disabled={creating || !newEmail.trim() || newPassword.length < 8}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider"
            >
              <UserCheck className="w-4 h-4 mr-2" />
              {creating ? "Creating…" : "Create Account"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Organizer list */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 bg-card" />
          <Skeleton className="h-14 bg-card" />
        </div>
      ) : organizers.length === 0 ? (
        <div className="py-8 text-center border-2 border-dashed border-border rounded-lg">
          <p className="text-muted-foreground text-sm">No organizers yet. Invite someone above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {organizers.map((o) => (
            <Card key={o.id} className={`bg-card border ${isExpired(o.expiresAt) ? "border-destructive/40" : "border-border"}`}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground truncate">
                      {o.firstName || o.lastName ? `${o.firstName} ${o.lastName}`.trim() : o.email}
                    </p>
                    {isExpired(o.expiresAt) && (
                      <Badge variant="destructive" className="text-xs px-1.5 py-0 shrink-0">Expired</Badge>
                    )}
                  </div>
                  {(o.firstName || o.lastName) && (
                    <p className="text-xs text-muted-foreground truncate">{o.email}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Joined {formatDate(o.createdAt)}</p>
                  {/* Expiry row */}
                  {editingExpiryId === o.id ? (
                    <div className="flex items-center gap-2 mt-1">
                      <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                      <Input
                        type="date"
                        value={editingExpiryValue}
                        onChange={(e) => setEditingExpiryValue(e.target.value)}
                        className="h-6 text-xs px-1.5 bg-background border-border w-32"
                        autoFocus
                      />
                      <button
                        className="text-xs text-primary hover:underline shrink-0"
                        disabled={savingExpiry}
                        onClick={() => handleSaveExpiry(o.id)}
                      >{savingExpiry ? "Saving…" : "Save"}</button>
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                        onClick={() => setEditingExpiryId(null)}
                      >Cancel</button>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-1 mt-0.5 group"
                      onClick={() => {
                        setEditingExpiryId(o.id);
                        setEditingExpiryValue(toDateInputValue(o.expiresAt));
                      }}
                    >
                      <Clock className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                      <span className={`text-xs ${isExpired(o.expiresAt) ? "text-destructive" : "text-muted-foreground"} group-hover:text-primary`}>
                        {o.expiresAt ? `Expires ${formatDate(o.expiresAt)}` : "No expiry — click to set"}
                      </span>
                    </button>
                  )}
                </div>
                {confirmRemoveId === o.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-destructive hover:bg-destructive/10"
                      disabled={removingId === o.id}
                      onClick={() => handleRemove(o.id)}
                    >
                      {removingId === o.id ? "Removing…" : "Confirm remove"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-muted-foreground"
                      onClick={() => setConfirmRemoveId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmRemoveId(o.id)}
                    title="Remove organizer"
                  >
                    <UserMinus className="w-4 h-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function CompletedTournamentCard({
  t,
  onDelete,
  onRequestDelete,
  isDeleting,
  onCancelDelete,
  onView,
  onReopen,
  isReopening,
}: {
  t: Tournament;
  onDelete: () => void;
  onRequestDelete: () => void;
  isDeleting: boolean;
  onCancelDelete: () => void;
  onView: () => void;
  onReopen: () => void;
  isReopening: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: standings } = useListTournamentStandings(t.id, {
    query: {
      queryKey: getListTournamentStandingsQueryKey(t.id),
      enabled: expanded,
    },
  });

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  const groupedStandings = standings?.reduce<Record<number, typeof standings>>((acc, row) => {
    if (!acc[row.groupId]) acc[row.groupId] = [];
    acc[row.groupId].push(row);
    return acc;
  }, {});

  return (
    <Card className="bg-card border border-border opacity-80 hover:opacity-100 transition-opacity">
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <span className="font-bold text-lg text-foreground truncate">{t.name}</span>
              <Badge variant="secondary" className="text-xs shrink-0">Completed</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Created {formatDate(t.createdAt)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground text-xs"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
              {expanded ? "Hide" : "Standings"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/10 text-xs"
              onClick={onReopen}
              disabled={isReopening}
              title="Reopen this tournament"
            >
              <RotateCcw className={`w-3.5 h-3.5 mr-1 ${isReopening ? "animate-spin" : ""}`} />
              Reopen
            </Button>
            {isDeleting ? (
              <>
                <Button size="sm" variant="ghost" className="text-xs text-destructive hover:bg-destructive/10" onClick={onDelete}>Confirm delete</Button>
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={onCancelDelete}>Cancel</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={onRequestDelete}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="border-border text-muted-foreground hover:text-foreground text-xs"
              onClick={onView}
            >
              View <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-border">
            {!standings ? (
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-20 bg-background/50" />
                <Skeleton className="h-20 bg-background/50" />
              </div>
            ) : standings.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">No standings data.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.values(groupedStandings ?? {}).map((rows) => {
                  const top3 = rows.slice(0, 3);
                  const groupName = top3[0]?.groupName ?? "";
                  return (
                    <div key={top3[0]?.groupId} className="bg-background/40 rounded-md p-3">
                      <p className="text-xs font-bold text-primary uppercase tracking-wider mb-2">{groupName}</p>
                      <div className="space-y-1.5">
                        {top3.map((row, idx) => (
                          <div key={row.teamId} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-4 shrink-0">{idx + 1}.</span>
                            <span className="text-sm text-foreground flex-1 truncate">{row.teamName}</span>
                            <span className="text-xs font-bold text-primary mono-font">{row.points}pts</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TournamentList() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { data: tournaments, isLoading } = useListTournaments();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [organizersLoading, setOrganizersLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/organizers", { credentials: "include" })
      .then(async (r) => {
        if (r.ok) {
          setIsAdmin(true);
          setOrganizers(await r.json());
        }
      })
      .catch(() => {})
      .finally(() => setOrganizersLoading(false));
  }, []);

  const createTournament = useCreateTournament({
    mutation: {
      onSuccess: (t) => {
        queryClient.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        navigate(`/tournaments/${t.id}/settings`);
      },
      onError: () => toast({ title: "Error", description: "Failed to create tournament.", variant: "destructive" }),
    },
  });

  const deleteTournament = useDeleteTournamentById({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        setDeletingId(null);
        toast({ title: "Tournament deleted" });
      },
      onError: () => toast({ title: "Error", description: "Failed to delete tournament.", variant: "destructive" }),
    },
  });

  const completeTournament = useCompleteTournament({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        toast({ title: "Tournament completed" });
      },
      onError: () => toast({ title: "Error", description: "Failed to mark tournament as completed.", variant: "destructive" }),
    },
  });

  const reopenTournament = useReopenTournament({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTournamentsQueryKey() });
        toast({ title: "Tournament reopened", description: "The tournament is now active again." });
      },
      onError: () => toast({ title: "Error", description: "Failed to reopen tournament.", variant: "destructive" }),
    },
  });

  const active = tournaments?.filter((t) => t.status === "active") ?? [];
  const completed = tournaments?.filter((t) => t.status === "completed") ?? [];

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background dark flex flex-col">
        <div className="h-16 bg-card border-b border-border flex items-center px-8 gap-3">
          <Activity className="w-6 h-6 text-primary" />
          <span className="font-bold text-2xl display-font tracking-wider text-primary mt-1">TOURNEY MANAGER</span>
        </div>
        <div className="flex-1 p-8 max-w-4xl mx-auto w-full space-y-4">
          <Skeleton className="h-12 w-64 bg-card" />
          <Skeleton className="h-24 bg-card" />
          <Skeleton className="h-24 bg-card" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background dark flex flex-col">
      <div className="h-16 bg-card border-b border-border flex items-center px-8 gap-3">
        <Activity className="w-6 h-6 text-primary" />
        <span className="font-bold text-2xl display-font tracking-wider text-primary mt-1">TOURNEY MANAGER</span>
        <div className="ml-auto flex items-center gap-3">
          {user && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              {user.primaryEmailAddress?.emailAddress}
            </span>
          )}
          <button
            onClick={() => signOut({ redirectUrl: "/" })}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-accent"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>

      <div className="flex-1 p-8 max-w-4xl mx-auto w-full space-y-10">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-4xl font-bold display-font text-foreground tracking-wide">TOURNAMENTS</h2>
            <p className="text-muted-foreground mt-1">Manage all your tournaments</p>
          </div>
          <Button
            onClick={() => createTournament.mutate({ data: { name: "New Tournament", groupCount: 4, teamsPerGroup: 4, courtCount: 2 } })}
            disabled={createTournament.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Tournament
          </Button>
        </div>

        {/* Active Tournaments */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <Clock className="w-5 h-5 text-primary" />
            <h3 className="text-xl font-bold display-font tracking-wide text-foreground">ACTIVE</h3>
            <span className="text-sm text-muted-foreground mono-font">({active.length})</span>
          </div>

          {active.length === 0 ? (
            <div className="py-12 text-center border-2 border-dashed border-border rounded-lg">
              <p className="text-muted-foreground mb-4">No active tournaments.</p>
              <Button
                variant="outline"
                onClick={() => createTournament.mutate({ data: { name: "New Tournament", groupCount: 4, teamsPerGroup: 4, courtCount: 2 } })}
                disabled={createTournament.isPending}
                className="border-primary/50 text-primary hover:bg-primary/10"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create your first tournament
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {active.map((t) => (
                <Card key={t.id} className="bg-card border border-border hover:border-primary/30 transition-colors">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-lg text-foreground truncate">{t.name}</span>
                        <Badge variant="outline" className="text-xs border-primary/30 text-primary shrink-0">Active</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">Created {formatDate(t.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-yellow-400 hover:bg-yellow-400/10 text-xs"
                        onClick={() => completeTournament.mutate({ id: t.id })}
                        title="Mark as completed"
                      >
                        <CheckCircle className="w-4 h-4 mr-1.5" />
                        Complete
                      </Button>
                      {deletingId === t.id ? (
                        <>
                          <Button size="sm" variant="ghost" className="text-xs text-destructive hover:bg-destructive/10" onClick={() => deleteTournament.mutate({ id: t.id })}>Confirm delete</Button>
                          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setDeletingId(null)}>Cancel</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => setDeletingId(t.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-wider text-xs"
                        onClick={() => navigate(`/tournaments/${t.id}`)}
                      >
                        Open <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Completed Tournaments */}
        {completed.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-4">
              <Trophy className="w-5 h-5 text-yellow-400" />
              <h3 className="text-xl font-bold display-font tracking-wide text-foreground">HISTORY</h3>
              <span className="text-sm text-muted-foreground mono-font">({completed.length})</span>
            </div>
            <div className="space-y-3">
              {completed.map((t) => (
                <CompletedTournamentCard
                  key={t.id}
                  t={t}
                  onDelete={() => deleteTournament.mutate({ id: t.id })}
                  onRequestDelete={() => setDeletingId(t.id)}
                  isDeleting={deletingId === t.id}
                  onCancelDelete={() => setDeletingId(null)}
                  onView={() => navigate(`/tournaments/${t.id}`)}
                  onReopen={() => reopenTournament.mutate({ id: t.id })}
                  isReopening={reopenTournament.isPending}
                />
              ))}
            </div>
          </section>
        )}

        {/* Admin: Orphaned tournaments */}
        {isAdmin && <OrphanedTournamentsPanel organizers={organizers} />}

        {/* Admin: Organizers panel */}
        {isAdmin && (
          <OrganizersPanel
            organizers={organizers}
            loading={organizersLoading}
            onOrganizersChange={setOrganizers}
          />
        )}
      </div>
    </div>
  );
}
