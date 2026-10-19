import re

with open("artifacts/tournament/src/pages/spectator.tsx", "r") as f:
    content = f.read()

# Replace the ladder components
old_ladder_block_pattern = r"function getCourtTheme\(courtNumber: number\) \{.*?\nexport default function Spectator\(\) \{"

new_ladder_block = """function LadderSpectatorView({ ladderState, tournamentName, sseStatus }: { ladderState: LadderState, tournamentName: string, sseStatus: "connecting" | "live" | "fallback" }) {
  if (!ladderState.started) {
    return (
      <div className="min-h-screen bg-[#061c10] flex flex-col items-center justify-center text-center space-y-4 text-[#fefce8] p-4 selection:bg-[#f5d547] selection:text-[#061c10]">
        <Zap className="w-16 h-16 text-[#f5d547] opacity-50 drop-shadow-[0_0_15px_rgba(245,213,71,0.5)]" />
        <h2 className="text-2xl sm:text-4xl font-bold display-font uppercase tracking-wider text-[#f5d547]">Tournament Not Started</h2>
        <p className="text-[#4ade80] max-w-md font-bold">The organizer is preparing the first batch. Matches and standings will appear here once the ladder begins.</p>
      </div>
    );
  }

  const resultsList = ladderState.history.slice().reverse().slice(0, 10);
  const hasResults = resultsList.length > 0;

  return (
    <div className="min-h-[100dvh] lg:h-[100dvh] bg-[#061c10] text-[#fefce8] font-sans flex flex-col lg:overflow-hidden z-50 selection:bg-[#f5d547] selection:text-[#061c10] animate-in fade-in duration-500" data-testid="section-ladder-spectator">
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
      <header className="border-b-2 border-[#f5d547]/30 bg-[#092615] px-4 py-3 sm:px-6 sm:py-4 flex justify-between items-end shrink-0 shadow-[0_4px_20px_rgba(0,0,0,0.4)] z-20">
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
               <span className="text-[#f5d547] text-[10px] sm:text-xs font-bold uppercase tracking-widest border-l-2 border-[#f5d547]/50 pl-3">Ladder Broadcast</span>
            </div>
            <h1 className="text-[#fefce8] font-black display-font text-3xl sm:text-5xl leading-none uppercase tracking-wide drop-shadow-sm truncate max-w-[60vw]" data-testid="text-tournament-name">{tournamentName}</h1>
         </div>
         <div className="text-right flex flex-col sm:flex-row items-end sm:items-baseline gap-1 sm:gap-3 shrink-0 pl-4">
            <span className="text-[#4ade80] text-[10px] sm:text-sm font-bold uppercase tracking-widest">Batch</span>
            <span className="text-[#f5d547] font-black display-font text-4xl sm:text-6xl leading-none drop-shadow-[0_0_10px_rgba(245,213,71,0.3)]" data-testid="text-batch-number">{ladderState.batchNumber}</span>
         </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 p-3 sm:p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 lg:min-h-0 z-10 relative">
        <div className="absolute top-0 left-1/4 w-[50%] h-[50%] bg-[#f5d547]/5 rounded-full blur-[120px] pointer-events-none" />
        
        {/* Left: Standings */}
        <section className="lg:col-span-3 flex flex-col border border-[#114a29] bg-[#0a1e12]/80 backdrop-blur-sm rounded-xl overflow-hidden shadow-xl lg:min-h-0 relative z-10">
           <div className="bg-[#114a29]/60 border-b border-[#114a29] p-2 flex items-center justify-center shrink-0">
              <h2 className="text-[#f5d547] font-black display-font text-xl sm:text-2xl tracking-wider uppercase">Standings</h2>
           </div>
           <div className="flex-1 lg:overflow-y-auto hide-scroll p-3 flex flex-col gap-3">
              {/* Top 3 Big */}
              <div className="flex flex-col gap-2">
                {ladderState.standings.slice(0, 3).map((standing, idx) => {
                  const isFirst = idx === 0;
                  const isSecond = idx === 1;
                  return (
                  <div key={standing.player.id} data-testid={`card-standing-${standing.rank}`} className={`relative flex items-center justify-between p-3 sm:p-4 rounded-lg border ${isFirst ? 'bg-gradient-to-br from-[#f5d547]/20 to-[#f5d547]/5 border-[#f5d547] shadow-[0_0_20px_-5px_rgba(245,213,71,0.4)]' : isSecond ? 'bg-gradient-to-br from-slate-300/15 to-slate-300/5 border-slate-300/40' : 'bg-gradient-to-br from-amber-600/15 to-amber-600/5 border-amber-600/40'}`}>
                     {isFirst && (
                       <div className="absolute -top-2 -right-2 bg-[#f5d547] text-[#061c10] px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest shadow-md transform rotate-3">
                         Leader
                       </div>
                     )}
                     <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <span className={`font-black display-font text-5xl sm:text-6xl leading-none w-8 sm:w-10 text-center drop-shadow-md shrink-0 ${isFirst ? 'text-[#f5d547]' : isSecond ? 'text-slate-300' : 'text-amber-600'}`}>{standing.rank}</span>
                        <div className="flex flex-col min-w-0 justify-center">
                           <span className="text-[#fefce8] font-black display-font text-2xl sm:text-3xl uppercase leading-none truncate">{standing.player.name}</span>
                           <div className="flex items-center gap-2 mt-1 sm:mt-2">
                             <span className="text-[#4ade80] text-[10px] sm:text-xs font-bold tracking-widest uppercase">{standing.wins}W - {standing.losses}L</span>
                             {standing.currentWinStreak >= 2 && (
                               <span className={`text-[9px] sm:text-[10px] font-black uppercase px-1.5 py-0.5 rounded leading-none shrink-0 ${standing.currentWinStreak >= 3 ? 'bg-orange-500 text-orange-950 shadow-[0_0_8px_rgba(249,115,22,0.6)] animate-pulse' : 'bg-[#4ade80] text-[#061c10]'}`}>{standing.currentWinStreak}W 🔥</span>
                             )}
                           </div>
                        </div>
                     </div>
                     <div className="flex flex-col items-end justify-center shrink-0 pl-2">
                        <span className="text-[#f5d547] font-black display-font text-4xl sm:text-5xl leading-none drop-shadow">{standing.points}</span>
                        <span className="text-[#4ade80] text-[10px] sm:text-xs uppercase font-bold tracking-widest mt-1">PTS</span>
                     </div>
                  </div>
                )})}
              </div>

              {/* Rest Small */}
              <div className="flex flex-col gap-1.5 mt-2">
                 {ladderState.standings.slice(3).map(standing => (
                   <div key={standing.player.id} data-testid={`row-standing-${standing.rank}`} className="flex items-center justify-between p-2 sm:p-2.5 rounded-lg bg-[#0d2a1a]/50 border border-[#114a29]/50 hover:bg-[#114a29]/50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                         <span className="text-[#4ade80]/60 font-black display-font text-2xl leading-none w-6 sm:w-8 text-center shrink-0">{standing.rank}</span>
                         <div className="flex flex-col min-w-0">
                           <span className="text-[#fefce8]/90 font-bold uppercase text-xs sm:text-sm truncate">{standing.player.name}</span>
                         </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 pl-2">
                         {standing.currentWinStreak >= 2 && (
                           <span className="text-[10px] font-black uppercase text-orange-400 shrink-0">🔥{standing.currentWinStreak}</span>
                         )}
                         <span className="text-[#f5d547]/90 font-black display-font text-2xl leading-none w-8 text-right">{standing.points}</span>
                      </div>
                   </div>
                 ))}
              </div>
           </div>
        </section>

        {/* Middle: Playing Now */}
        <section className="lg:col-span-6 flex flex-col border border-[#114a29] bg-[#0a1e12]/80 backdrop-blur-sm rounded-xl overflow-hidden shadow-xl lg:min-h-0 relative z-10">
           <div className="bg-[#114a29]/60 border-b border-[#114a29] p-3 flex items-center justify-center shrink-0">
              <h2 className="text-[#f5d547] font-black display-font text-2xl sm:text-3xl tracking-wider uppercase drop-shadow">Playing Now</h2>
           </div>
           <div className="flex-1 lg:overflow-y-auto hide-scroll p-3 sm:p-5 lg:p-6 content-start">
             <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
               {ladderState.courts.map(court => (
                 <div key={court.courtNumber} data-testid={`card-court-${court.courtNumber}`} className="border-2 border-[#114a29] rounded-xl overflow-hidden flex flex-col bg-[#0d2a1a] shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
                   <div className="bg-gradient-to-r from-[#114a29] to-[#0a1e12] p-2 sm:p-3 px-4 border-b-2 border-[#114a29] flex justify-between items-center shrink-0">
                      <span className="text-[#f5d547] font-black display-font text-2xl sm:text-3xl tracking-wider uppercase drop-shadow">COURT {court.courtNumber}</span>
                      {court.activeGame && !court.activeGame.played ? (
                        <span className="text-[#fefce8] text-[10px] sm:text-xs font-black uppercase tracking-widest flex items-center gap-1.5 bg-red-600 px-2 py-0.5 rounded shadow-[0_0_10px_rgba(220,38,38,0.6)] shrink-0">
                           <div className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
                           LIVE
                        </span>
                      ) : (
                        <span className="text-[#4ade80]/50 text-[10px] sm:text-xs font-bold uppercase tracking-widest border border-[#4ade80]/20 px-2 py-0.5 rounded shrink-0">WAITING</span>
                      )}
                   </div>
                   
                   <div className="p-3 sm:p-4 flex flex-col gap-2 sm:gap-3 relative">
                      {court.activeGame && !court.activeGame.played ? (
                        <>
                          <div className="absolute inset-0 bg-gradient-to-b from-[#f5d547]/5 to-transparent pointer-events-none" />
                          <div className="flex bg-[#05170d] border border-[#1a6338] rounded-lg items-stretch shadow-md overflow-hidden relative z-10">
                             <div className="flex-1 p-3 sm:p-4 flex items-center gap-3 min-w-0">
                               <span className="text-[#fefce8] font-black display-font text-2xl sm:text-3xl uppercase tracking-wide truncate mt-1">
                                 {court.activeGame.homeTeam.players.map(p=>p.name).join(" & ")}
                               </span>
                             </div>
                             <div className="w-20 sm:w-28 bg-gradient-to-br from-[#114a29] to-[#0a1e12] border-l border-[#1a6338] flex items-center justify-center p-2 shadow-inner shrink-0">
                               <span className="text-[#f5d547] font-black display-font text-5xl sm:text-6xl leading-none drop-shadow-md">
                                 {court.activeGame.homeScore ?? 0}
                               </span>
                             </div>
                          </div>
                          <div className="flex bg-[#05170d] border border-[#1a6338] rounded-lg items-stretch shadow-md overflow-hidden relative z-10">
                             <div className="flex-1 p-3 sm:p-4 flex items-center gap-3 min-w-0">
                               <span className="text-[#fefce8] font-black display-font text-2xl sm:text-3xl uppercase tracking-wide truncate mt-1">
                                 {court.activeGame.awayTeam.players.map(p=>p.name).join(" & ")}
                               </span>
                             </div>
                             <div className="w-20 sm:w-28 bg-gradient-to-br from-[#114a29] to-[#0a1e12] border-l border-[#1a6338] flex items-center justify-center p-2 shadow-inner shrink-0">
                               <span className="text-[#f5d547] font-black display-font text-5xl sm:text-6xl leading-none drop-shadow-md">
                                 {court.activeGame.awayScore ?? 0}
                               </span>
                             </div>
                          </div>
                        </>
                      ) : (
                        <div className="py-12 flex flex-col items-center justify-center text-[#4ade80]/30">
                           <Radio className="w-8 h-8 mb-2 opacity-50" />
                           <span className="font-bold text-sm uppercase tracking-widest text-center">No active game</span>
                        </div>
                      )}
                   </div>
                 </div>
               ))}
             </div>
           </div>
        </section>

        {/* Right: Queue */}
        <section className="lg:col-span-3 flex flex-col border border-[#114a29] bg-[#0a1e12]/80 backdrop-blur-sm rounded-xl overflow-hidden shadow-xl lg:min-h-0 relative z-10">
           <div className="bg-[#114a29]/60 border-b border-[#114a29] p-2 flex items-center justify-center shrink-0">
              <h2 className="text-[#f5d547] font-black display-font text-xl sm:text-2xl tracking-wider uppercase">Queue</h2>
           </div>
           <div className="flex-1 lg:overflow-y-auto hide-scroll p-3 sm:p-4 flex flex-col gap-4 sm:gap-6">
              {ladderState.courts.map(court => (
                <div key={court.courtNumber} className="flex flex-col gap-2 bg-[#0d2a1a]/40 p-3 rounded-lg border border-[#114a29]/50">
                   <div className="text-[#4ade80] text-xs sm:text-sm font-black uppercase tracking-widest border-b border-[#114a29] pb-2 flex justify-between items-center">
                     <span>Court {court.courtNumber} Queue</span>
                     <span className="bg-[#114a29] text-[#fefce8] px-2 py-0.5 rounded">{court.waitingPlayers.length}</span>
                   </div>
                   <div className="flex flex-col gap-1.5">
                     {court.waitingPlayers.length > 0 ? (
                       court.waitingPlayers.map((p, i) => (
                         <div key={p.id} className="flex items-center gap-3 p-2 bg-[#0a1e12] border border-[#114a29]/30 rounded hover:bg-[#114a29]/40 transition-colors">
                            <span className="text-[#f5d547]/80 font-black display-font text-xl w-6 text-center leading-none mt-0.5 shrink-0">{i+1}</span>
                            <span className="text-[#fefce8]/90 text-sm sm:text-base font-bold uppercase truncate min-w-0">{p.name}</span>
                         </div>
                       ))
                     ) : (
                       <div className="text-center text-[#4ade80]/30 text-xs font-bold uppercase py-3 border border-dashed border-[#114a29]/50 rounded">Queue Empty</div>
                     )}
                   </div>
                </div>
              ))}
           </div>
        </section>
      </main>

      {/* Footer Ticker: Recent Results */}
      <footer className="h-10 sm:h-12 border-t-2 border-[#f5d547]/30 bg-[#061c10] flex items-center shrink-0 overflow-hidden relative z-20 shadow-[0_-4px_15px_rgba(0,0,0,0.3)]">
         <div className="absolute left-0 top-0 bottom-0 w-24 sm:w-32 bg-gradient-to-r from-[#061c10] to-transparent z-10 pointer-events-none" />
         <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-l from-[#061c10] to-transparent z-10 pointer-events-none" />
         
         <div className="absolute left-3 sm:left-4 z-20 bg-[#f5d547] text-[#061c10] px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-black uppercase tracking-widest rounded shadow-md">
           Recent Results
         </div>
         
         <div className="flex-1 overflow-hidden ml-28 sm:ml-36 flex items-center h-full group">
            {hasResults ? (
              <div className="flex whitespace-nowrap w-max animate-broadcast-marquee group-hover:[animation-play-state:paused]">
                <div className="flex gap-16 pr-16 items-center">
                  {resultsList.map((game) => (
                    <div key={game.id} className="flex items-center gap-3 bg-[#0a1e12] px-3 py-1 rounded-full border border-[#114a29]">
                       <span className="text-[#4ade80] text-[10px] font-black uppercase tracking-widest">CT {game.courtNumber}</span>
                       <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#fefce8]">
                         <span>{game.homeTeam.players.map(p=>p.name).join(" & ")}</span>
                         <span className="text-[#f5d547]">{game.homeScore}</span>
                         <span className="text-[#4ade80]/30">-</span>
                         <span className="text-[#f5d547]">{game.awayScore}</span>
                         <span>{game.awayTeam.players.map(p=>p.name).join(" & ")}</span>
                       </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-16 pr-16 items-center">
                  {resultsList.map((game) => (
                    <div key={`dup-${game.id}`} className="flex items-center gap-3 bg-[#0a1e12] px-3 py-1 rounded-full border border-[#114a29]">
                       <span className="text-[#4ade80] text-[10px] font-black uppercase tracking-widest">CT {game.courtNumber}</span>
                       <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#fefce8]">
                         <span>{game.homeTeam.players.map(p=>p.name).join(" & ")}</span>
                         <span className="text-[#f5d547]">{game.homeScore}</span>
                         <span className="text-[#4ade80]/30">-</span>
                         <span className="text-[#f5d547]">{game.awayScore}</span>
                         <span>{game.awayTeam.players.map(p=>p.name).join(" & ")}</span>
                       </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-[#4ade80]/50 text-xs font-bold uppercase tracking-widest px-4">Waiting for first match results...</div>
            )}
         </div>
      </footer>
    </div>
  )
}

export default function Spectator() {"""

content = re.sub(old_ladder_block_pattern, new_ladder_block, content, flags=re.DOTALL)

# Add the short-circuit condition inside Spectator
old_spectator_return_pattern = r"  return \(\n    <div className=\"min-h-screen bg-background dark text-foreground\">\n      \{\/\* Header \*\/\}"

new_spectator_return = """  if (isIndividualLadder && ladderState) {
    return <LadderSpectatorView ladderState={ladderState} tournamentName={tournament.name} sseStatus={sseStatus} />;
  }

  return (
    <div className="min-h-screen bg-background dark text-foreground">
      {/* Header */}"""

content = re.sub(old_spectator_return_pattern, new_spectator_return, content)

# Check if LadderSpectatorView is no longer rendered in the main layout
content = re.sub(r"        \{isIndividualLadder && <LadderSpectatorView ladderState=\{ladderState\} \/>\}\n", "", content)

with open("artifacts/tournament/src/pages/spectator.tsx", "w") as f:
    f.write(content)
