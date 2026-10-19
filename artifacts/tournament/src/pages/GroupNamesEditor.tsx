import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateGroupName,
  getListTournamentGroupsQueryKey,
  getListTournamentStandingsQueryKey,
  getListTournamentMatchesQueryKey,
  getGetTeamEventStateQueryKey,
  getGetBreakoutKnockoutsQueryKey,
  type Group,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Check, Edit2, X } from "lucide-react";
import { errorMessage } from "./BreakoutKnockouts";

function GroupNameRow({ group, tournamentId }: { group: Group; tournamentId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(group.name);
  const update = useUpdateGroupName({
    mutation: {
      onSuccess: () => {
        [getListTournamentGroupsQueryKey, getListTournamentStandingsQueryKey, getListTournamentMatchesQueryKey, getGetTeamEventStateQueryKey, getGetBreakoutKnockoutsQueryKey]
          .forEach((k) => queryClient.invalidateQueries({ queryKey: k(tournamentId) }));
        setEditing(false);
        toast({ title: "Group renamed" });
      },
      onError: (err) => toast({ title: "Rename failed", description: errorMessage(err, "Please try again."), variant: "destructive" }),
    },
  });
  const trimmed = value.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 80;
  const save = () => {
    if (!valid) return;
    if (trimmed === group.name) { setEditing(false); return; }
    update.mutate({ id: group.id, data: { name: trimmed } });
  };

  return (
    <li className="flex items-center gap-2 py-2" data-testid={`row-group-name-${group.id}`}>
      <span className="w-8 shrink-0 mono-font text-xs text-muted-foreground">#{group.groupNumber}</span>
      {editing ? (
        <>
          <Input
            autoFocus
            aria-label={`Name for group ${group.groupNumber}`}
            value={value}
            maxLength={80}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setValue(group.name); setEditing(false); } }}
            aria-invalid={!valid}
            className="h-9 bg-background border-border"
            data-testid={`input-group-name-${group.id}`}
          />
          <Button size="sm" className="h-9 bg-primary text-primary-foreground" disabled={!valid || update.isPending} onClick={save} aria-label="Save group name" data-testid={`button-save-group-name-${group.id}`}>
            <Check className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" className="h-9" disabled={update.isPending} onClick={() => { setValue(group.name); setEditing(false); }} aria-label="Cancel" data-testid={`button-cancel-group-name-${group.id}`}>
            <X className="w-4 h-4" />
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 truncate font-medium" data-testid={`text-group-name-${group.id}`}>{group.name}</span>
          <Button size="sm" variant="ghost" className="h-8 text-muted-foreground hover:text-primary" onClick={() => { setValue(group.name); setEditing(true); }} aria-label={`Rename ${group.name}`} data-testid={`button-edit-group-name-${group.id}`}>
            <Edit2 className="w-3.5 h-3.5" />
          </Button>
        </>
      )}
      {editing && !valid && <span className="sr-only">Name must be 1 to 80 characters.</span>}
    </li>
  );
}

export function GroupNamesEditor({ tournamentId, groups }: { tournamentId: number; groups: Group[] }) {
  const sorted = [...groups].sort((a, b) => a.groupNumber - b.groupNumber);
  return (
    <Card className="bg-card border border-border" data-testid="card-group-names">
      <CardHeader>
        <CardTitle className="display-font text-xl tracking-wide text-primary">GROUP NAMES</CardTitle>
        <p className="text-xs text-muted-foreground">Rename groups for spectators and standings. 1–80 characters.</p>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No groups yet — generate the tournament to create them.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {sorted.map((g) => <GroupNameRow key={g.id} group={g} tournamentId={tournamentId} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
