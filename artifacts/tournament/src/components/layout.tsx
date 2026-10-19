import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Settings, Users, Swords, Trophy, Activity, ArrowLeft, Eye, LogOut, Menu, X } from "lucide-react";
import { useClerk } from "@clerk/react";
import {
  useGetTournamentById,
  getListTournamentTeamsQueryKey,
  getListTournamentMatchesQueryKey,
  getListTournamentStandingsQueryKey,
  getListKnockoutMatchesQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface LayoutProps {
  children: React.ReactNode;
  tournamentId: number;
}

export function Layout({ children, tournamentId }: LayoutProps) {
  const [location] = useLocation();
  const { data: tournament } = useGetTournamentById(tournamentId);
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(tournamentId)) return;
    const stream = new EventSource(`/api/tournaments/${tournamentId}/events`);
    const onFixtureChange = (event: MessageEvent) => {
      try {
        const notice = JSON.parse(event.data) as { message?: string };
        toast({ title: "Fixture change for organizers", description: notice.message ?? "Fixtures have changed. Review the match schedule." });
      } catch {
        toast({ title: "Fixture change for organizers", description: "Fixtures have changed. Review the match schedule." });
      }
      queryClient.invalidateQueries({ queryKey: getListTournamentTeamsQueryKey(tournamentId) });
      queryClient.invalidateQueries({ queryKey: getListTournamentMatchesQueryKey(tournamentId) });
      queryClient.invalidateQueries({ queryKey: getListTournamentStandingsQueryKey(tournamentId) });
      queryClient.invalidateQueries({ queryKey: getListKnockoutMatchesQueryKey(tournamentId) });
    };
    stream.addEventListener("fixture-change", onFixtureChange);
    return () => { stream.removeEventListener("fixture-change", onFixtureChange); stream.close(); };
  }, [tournamentId, queryClient, toast]);

  const base = `/tournaments/${tournamentId}`;

  const navItems = [
    { href: base, label: "Dashboard", icon: LayoutDashboard },
    { href: `${base}/settings`, label: "Tournament Setup", icon: Settings },
    { href: `${base}/groups`, label: "Groups & Teams", icon: Users },
    { href: `${base}/matches`, label: "Matches", icon: Swords },
    { href: `${base}/standings`, label: "Standings", icon: Trophy },
  ];

  return (
    <div className="min-h-screen flex bg-background dark">
      <div className="w-64 bg-card border-r border-border flex-col hidden lg:flex">
        <div className="h-16 flex items-center px-6 border-b border-border bg-background/50">
          <Activity className="w-6 h-6 text-primary mr-3" />
          <span className="font-bold text-2xl display-font tracking-wider text-primary mt-1">TOURNEY MANAGER</span>
        </div>

        <div className="px-4 py-3 border-b border-border">
          <Link href="/" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group">
            <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
            <span>All Tournaments</span>
          </Link>
        </div>

        <div className="flex-1 py-4 px-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center px-4 py-3 rounded-md transition-colors ${
                  active
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className={`w-5 h-5 mr-3 ${active ? "text-primary" : ""}`} />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="px-4 pb-4 space-y-2">
          <Link
            href={`/spectator/${tournamentId}`}
            className="flex items-center gap-2 px-4 py-2 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Spectator View</span>
          </Link>
          <button
            onClick={() => signOut({ redirectUrl: "/" })}
            className="w-full flex items-center gap-2 px-4 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-card shadow-2xl">
            <div className="h-16 flex items-center gap-3 px-5 border-b border-border">
              <Activity className="w-6 h-6 text-primary" />
              <span className="font-bold text-xl display-font tracking-wider text-primary mt-1">TOURNEY MANAGER</span>
              <button
                type="button"
                aria-label="Close navigation menu"
                className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-4 py-3 border-b border-border">
              <Link href="/" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-4 h-4" />
                <span>All Tournaments</span>
              </Link>
            </div>
            <nav className="flex-1 space-y-1 p-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = location === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center px-4 py-3 rounded-md transition-colors ${
                      active ? "bg-primary/10 text-primary border border-primary/20" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <Icon className="w-5 h-5 mr-3" />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="space-y-2 border-t border-border p-4">
              <Link
                href={`/spectator/${tournamentId}`}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2 px-4 py-3 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground"
              >
                <Eye className="w-4 h-4" />
                <span>Spectator View</span>
              </Link>
              <button
                onClick={() => signOut({ redirectUrl: "/" })}
                className="w-full flex items-center gap-2 px-4 py-3 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="min-h-16 flex items-center px-3 sm:px-5 lg:px-8 border-b border-border bg-card gap-3">
          <button
            type="button"
            aria-label="Open navigation menu"
            className="lg:hidden rounded-md border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="min-w-0 truncate text-xl sm:text-2xl lg:text-3xl font-bold display-font text-foreground tracking-wide mt-1">
            {tournament?.name || "Loading..."}
          </h1>
          {tournament?.status === "completed" && (
            <Badge variant="secondary" className="text-xs uppercase tracking-wider mt-1">Completed</Badge>
          )}
        </header>
        <main className="flex-1 overflow-auto p-3 sm:p-5 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
