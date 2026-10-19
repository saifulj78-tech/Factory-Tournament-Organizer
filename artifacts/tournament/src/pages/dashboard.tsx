import { useState } from "react";
import { useParams } from "wouter";
import { useGetTournamentById, useListTournamentGroups, useListTournamentTeams, useListTournamentMatches, useListTournamentStandings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Swords, Trophy, Layers, Share2, Copy, Check, QrCode } from "lucide-react";
import { Link } from "wouter";
import { QRCodeSVG } from "qrcode.react";

function useSpectatorUrl(tournamentId: number) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base}/spectator/${tournamentId}`;
}

function ShareDialog({ tournamentId, open, onOpenChange }: { tournamentId: number; open: boolean; onOpenChange: (v: boolean) => void }) {
  const spectatorUrl = useSpectatorUrl(tournamentId);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(spectatorUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-sm">
        <DialogHeader>
          <DialogTitle className="display-font tracking-wide text-xl">SHARE SPECTATOR VIEW</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-6 py-2">
          <div className="p-3 bg-white rounded-lg">
            <QRCodeSVG
              value={spectatorUrl}
              size={200}
              bgColor="#ffffff"
              fgColor="#0f172a"
              level="M"
            />
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Scan this QR code or share the link below. No login required.
          </p>

          <div className="w-full flex gap-2">
            <div className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-xs text-muted-foreground truncate font-mono">
              {spectatorUrl}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="shrink-0 border-border"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Dashboard() {
  const { id } = useParams<{ id: string }>();
  const tournamentId = Number(id);
  const [shareOpen, setShareOpen] = useState(false);

  const { data: tournament, isLoading: isLoadingTournament } = useGetTournamentById(tournamentId);
  const { data: groups, isLoading: isLoadingGroups } = useListTournamentGroups(tournamentId);
  const { data: teams, isLoading: isLoadingTeams } = useListTournamentTeams(tournamentId);
  const { data: matches, isLoading: isLoadingMatches } = useListTournamentMatches(tournamentId);
  const { data: standings, isLoading: isLoadingStandings } = useListTournamentStandings(tournamentId);

  const isLoading = isLoadingTournament || isLoadingGroups || isLoadingTeams || isLoadingMatches || isLoadingStandings;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64 bg-card" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Skeleton className="h-32 bg-card" />
          <Skeleton className="h-32 bg-card" />
          <Skeleton className="h-32 bg-card" />
          <Skeleton className="h-32 bg-card" />
        </div>
      </div>
    );
  }

  const playedMatches = matches?.filter(m => m.played).length || 0;
  const totalMatches = matches?.length || 0;

  const topTeams = groups?.map(g => {
    const groupStandings = standings?.filter(s => s.groupId === g.id) || [];
    return groupStandings.length > 0 ? groupStandings[0] : null;
  }).filter(Boolean);

  const base = `/tournaments/${tournamentId}`;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-bold display-font text-foreground tracking-wide">DASHBOARD</h2>
          <p className="text-muted-foreground mt-1">Overview of {tournament?.name}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShareOpen(true)}
          className="flex items-center gap-2 border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
        >
          <QrCode className="w-4 h-4" />
          <Share2 className="w-4 h-4" />
          <span>Share</span>
        </Button>
      </div>

      <ShareDialog tournamentId={tournamentId} open={shareOpen} onOpenChange={setShareOpen} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-card border-l-4 border-l-primary hover:bg-accent/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Total Groups</CardTitle>
            <Layers className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold mono-font">{groups?.length || 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-l-4 border-l-blue-500 hover:bg-accent/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Total Teams</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold mono-font">{teams?.length || 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-l-4 border-l-orange-500 hover:bg-accent/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Total Matches</CardTitle>
            <Swords className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold mono-font">{totalMatches}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-l-4 border-l-purple-500 hover:bg-accent/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Matches Played</CardTitle>
            <Trophy className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold mono-font">{playedMatches} <span className="text-lg text-muted-foreground">/ {totalMatches}</span></div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-2xl font-bold display-font text-foreground tracking-wide">GROUP LEADERS</h3>
          <Link href={`${base}/standings`} className="text-primary hover:underline text-sm font-medium">View Full Standings &rarr;</Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {topTeams?.map((standing: any) => (
            <Card key={standing.groupId} className="bg-card overflow-hidden">
              <div className="bg-muted px-4 py-2 border-b border-border flex justify-between items-center">
                <span className="font-bold display-font text-xl tracking-wide text-primary">GROUP {standing.groupName}</span>
              </div>
              <div className="p-6">
                <div className="text-2xl font-bold mb-4">{standing.teamName}</div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-background rounded p-2 border border-border">
                    <div className="text-xs text-muted-foreground mb-1 uppercase">PTS</div>
                    <div className="text-xl font-bold mono-font text-primary">{standing.points}</div>
                  </div>
                  <div className="bg-background rounded p-2 border border-border">
                    <div className="text-xs text-muted-foreground mb-1 uppercase">W-D-L</div>
                    <div className="text-lg font-bold mono-font">{standing.wins}-{standing.draws}-{standing.losses}</div>
                  </div>
                  <div className="bg-background rounded p-2 border border-border">
                    <div className="text-xs text-muted-foreground mb-1 uppercase">GD</div>
                    <div className="text-lg font-bold mono-font">{standing.goalsFor - standing.goalsAgainst > 0 ? "+" : ""}{standing.goalsFor - standing.goalsAgainst}</div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {(!topTeams || topTeams.length === 0) && (
            <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed border-border rounded-lg">
              No groups generated yet. Go to Tournament Setup.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
