import { useMemo } from "react"

import Court from "./Court"
import { buildShotChart } from "../utils/shotChart"

export default function GameShotChart({ game }) {
  const chart = useMemo(() => buildShotChart(game), [game])
  const hasShots = chart.shots.length > 0

  return (
    <figure className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-900/60 shadow-lg shadow-black/20">
      <figcaption className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 p-5 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Shot chart</h2>
          <p className="mt-1 text-sm text-slate-400">Every field goal attempt from this game.</p>
        </div>
        <div className="flex items-center gap-4 pt-1 text-sm tabular-nums text-slate-300">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-400" aria-hidden="true" />
            {chart.made} made
          </span>
          <span className="flex items-center gap-1.5">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 text-red-400" aria-hidden="true">
              <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {chart.missed} missed
          </span>
        </div>
      </figcaption>

      <div className="border-t border-white/10 bg-slate-900">
        <Court
          shots={chart.shots}
          dotRadius={chart.dotRadius}
          label={`Half-court diagram: ${chart.made} made and ${chart.missed} missed field goals`}
        />
      </div>

      <p className="border-t border-white/10 px-5 py-3 text-xs text-slate-400">
        {hasShots
          ? "Dot counts come from this game's box score. Exact shot locations are not tracked, so threes sit behind the arc and twos fill the space inside it."
          : "No field goal attempts were recorded in this game."}
      </p>
    </figure>
  )
}
