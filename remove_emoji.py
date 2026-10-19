import re

with open("artifacts/tournament/src/pages/spectator.tsx", "r") as f:
    content = f.read()

content = content.replace(
    """<span className={`text-[9px] sm:text-[10px] font-black uppercase px-1.5 py-0.5 rounded leading-none shrink-0 ${standing.currentWinStreak >= 3 ? 'bg-orange-500 text-orange-950 shadow-[0_0_8px_rgba(249,115,22,0.6)] animate-pulse' : 'bg-[#4ade80] text-[#061c10]'}`}>{standing.currentWinStreak}W 🔥</span>""",
    """<span className={`text-[9px] sm:text-[10px] font-black uppercase px-1.5 py-0.5 rounded flex items-center gap-0.5 leading-none shrink-0 ${standing.currentWinStreak >= 3 ? 'bg-orange-500 text-orange-950 shadow-[0_0_8px_rgba(249,115,22,0.6)] animate-pulse' : 'bg-[#4ade80] text-[#061c10]'}`}>{standing.currentWinStreak}W <Flame className="w-2.5 h-2.5" /></span>"""
)

content = content.replace(
    """<span className="text-[10px] font-black uppercase text-orange-400 shrink-0">🔥{standing.currentWinStreak}</span>""",
    """<span className="text-[10px] font-black uppercase text-orange-400 shrink-0 flex items-center gap-0.5"><Flame className="w-3 h-3" />{standing.currentWinStreak}</span>"""
)

with open("artifacts/tournament/src/pages/spectator.tsx", "w") as f:
    f.write(content)
