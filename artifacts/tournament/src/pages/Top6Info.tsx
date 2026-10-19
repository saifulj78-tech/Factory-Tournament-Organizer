import { ListOrdered } from "lucide-react";

export type KnockoutMode = "single" | "double" | "top6";

/** Internal Top 6 draws keep 8 slots; seeds 1 and 2 receive virtual BYE quarterfinals that we hide. */
export function isTop6VirtualBye(match: { homeTeamId?: number | null; awayTeamId?: number | null; played?: boolean; bye?: boolean; round?: string | number }, quarterRound: string | number) {
  if (match.round !== quarterRound) return false;
  return !!match.bye || (!!match.played && (match.homeTeamId == null || match.awayTeamId == null));
}

export function Top6Info({ label, compact = false, testId = "text-top6-info" }: { label?: string; compact?: boolean; testId?: string }) {
  return (
    <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-xs" data-testid={testId}>
      <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-primary">
        <ListOrdered className="h-3.5 w-3.5" />
        Top 6 Playoff{label ? ` · ${label}` : ""}
      </div>
      {!compact && (
        <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-3">
          <span><strong className="text-foreground">Quarterfinals:</strong> 3 v 6, 4 v 5</span>
          <span><strong className="text-foreground">Semifinals:</strong> 1 v winner 4/5, 2 v winner 3/6</span>
          <span><strong className="text-foreground">Final:</strong> semifinal winners</span>
        </div>
      )}
      <p className="mt-1.5 text-muted-foreground">Seeds 1 and 2 skip the quarterfinals and go straight to the semifinals.</p>
    </div>
  );
}
