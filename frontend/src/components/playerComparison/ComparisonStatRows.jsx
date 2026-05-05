import { COMPARISON_STATS, formatComparisonValue, getComparisonValue } from "./comparisonStats"

function getWinnerClass(leftValue, rightValue, higherIsBetter, side) {
  if (leftValue == null || rightValue == null || leftValue === rightValue) {
    return "border-white/10 bg-white/5 text-white"
  }

  const leftWins = higherIsBetter ? leftValue > rightValue : leftValue < rightValue
  const sideWins = side === "left" ? leftWins : !leftWins

  return sideWins
    ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100"
    : "border-white/10 bg-white/5 text-slate-300"
}

function PlayerHeader({ player, statLine }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
      {player ? (
        <div className="flex items-center gap-3">
          <img
            src={player.headshot_url}
            alt=""
            className="h-16 w-16 rounded-xl border border-white/10 bg-slate-900 object-cover"
          />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-white">{player.name}</p>
            <p className="text-xs text-slate-400">
              {statLine ? `${statLine.gp} GP` : "No games in selected scope"}
            </p>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-lg font-semibold text-white">Select player</p>
          <p className="text-xs text-slate-400">No comparison data yet</p>
        </div>
      )}
    </div>
  )
}

export default function ComparisonStatRows({ leftPlayer, rightPlayer, leftStats, rightStats }) {
  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/45 p-4 shadow-lg shadow-black/20">
      <div className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] gap-3">
        <PlayerHeader player={leftPlayer} statLine={leftStats} />
        <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Stat
        </div>
        <PlayerHeader player={rightPlayer} statLine={rightStats} />

        {COMPARISON_STATS.map(stat => {
          const leftValue = getComparisonValue(stat, leftStats)
          const rightValue = getComparisonValue(stat, rightStats)
          const leftClass = getWinnerClass(leftValue, rightValue, stat.higherIsBetter, "left")
          const rightClass = getWinnerClass(leftValue, rightValue, stat.higherIsBetter, "right")

          return (
            <div key={stat.key} className="contents">
              <div className={`rounded-xl border px-3 py-3 text-right text-sm font-semibold ${leftClass}`}>
                {formatComparisonValue(stat, leftValue)}
              </div>
              <div className="flex min-h-[46px] items-center justify-center rounded-xl border border-white/10 bg-slate-900/70 px-2 text-center text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                {stat.label}
              </div>
              <div className={`rounded-xl border px-3 py-3 text-sm font-semibold ${rightClass}`}>
                {formatComparisonValue(stat, rightValue)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
