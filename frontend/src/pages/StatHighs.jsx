import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import axios from "axios"

import { API_BASE } from "../api"
import { getGameLogKey } from "../utils/gameLog"
import { readPlayerSummaryCache, writePlayerSummaryCache } from "../utils/playerSummaryCache"

const STAT_LABELS = {
  pts: "PTS",
  reb: "REB",
  ast: "AST",
  stl: "STL",
  blk: "BLK",
  fgm: "FGM",
  three_pm: "3PM",
  ftm: "FTM",
  tov: "TOV",
  min: "MIN",
  plus_minus: "+/-",
}

function toNumericValue(value) {
  if (value == null || value === "") {
    return 0
  }

  const parsedValue = Number(value)
  return Number.isNaN(parsedValue) ? 0 : parsedValue
}

function parseGameDate(game) {
  if (!game?.game_date) {
    return null
  }

  const parsedDate = new Date(`${game.game_date}T00:00:00`)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function formatDisplayDate(game) {
  const parsedDate = parseGameDate(game)

  if (parsedDate) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(parsedDate)
  }

  return game?.date || "Date unavailable"
}

function formatValue(statKey, value) {
  if (statKey === "plus_minus") {
    return value > 0 ? `+${value}` : `${value}`
  }

  return `${Math.round(value)}`
}

function buildStatEntries(seasonGameLogs, statKey) {
  return Object.entries(seasonGameLogs || {}).flatMap(([seasonId, games]) => {
    if (!Array.isArray(games)) {
      return []
    }

    return games.map((game, index) => ({
      seasonId: String(seasonId),
      game,
      index,
      value: toNumericValue(game?.[statKey]),
      dateValue: parseGameDate(game)?.getTime() || 0,
    }))
  })
}

export default function StatHighs() {
  const navigate = useNavigate()
  const { id, statKey } = useParams()
  const cachedSummary = readPlayerSummaryCache(id)
  const [data, setData] = useState(cachedSummary)
  const [loading, setLoading] = useState(() => !cachedSummary)

  useEffect(() => {
    const nextCachedSummary = readPlayerSummaryCache(id)
    let ignore = false

    setData(nextCachedSummary)
    setLoading(!nextCachedSummary)

    axios
      .get(`${API_BASE}/player/${id}/summary`)
      .then(res => {
        if (ignore) {
          return
        }

        setData(res.data)
        writePlayerSummaryCache(id, res.data)
      })
      .catch(error => console.error(error))
      .finally(() => {
        if (ignore) {
          return
        }

        setLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [id])

  const resolvedStatKey = STAT_LABELS[statKey] ? statKey : "pts"
  const statLabel = STAT_LABELS[resolvedStatKey] || "PTS"
  const seasonGameLogs = data?.season_game_logs || {}
  const sortedEntries = useMemo(() => {
    const entries = buildStatEntries(seasonGameLogs, resolvedStatKey)

    return entries.sort((leftEntry, rightEntry) => {
      if (rightEntry.value !== leftEntry.value) {
        return rightEntry.value - leftEntry.value
      }

      return rightEntry.dateValue - leftEntry.dateValue
    })
  }, [seasonGameLogs, resolvedStatKey])
  const topEntries = sortedEntries.slice(0, 50)

  function openGameSummary(entry) {
    const gameKey = getGameLogKey(entry.game, entry.index)
    navigate(`/player/${id}/games/${encodeURIComponent(gameKey)}?season=${encodeURIComponent(entry.seasonId)}`)
  }

  if (!data || loading) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(34,197,94,0.18),_transparent_28%)]" />
        <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
          <div className="w-full max-w-3xl rounded-[2rem] border border-white/10 bg-white/5 p-10 text-center shadow-2xl shadow-black/30 backdrop-blur-xl animate-fade-up">
            <div className="mx-auto mb-6 h-16 w-16 rounded-full border-4 border-blue-400/30 border-t-blue-400 animate-spin" />
            <h1 className="text-3xl font-semibold tracking-tight text-white">Loading stat highs</h1>
            <p className="mt-3 text-sm text-slate-300 sm:text-base">Resolving cached game logs for this player.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_26%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,1))]" />
      <div className="absolute left-[-6rem] top-20 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl animate-float-slow" />
      <div className="absolute bottom-10 right-[-5rem] h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl animate-float-delayed" />

      <div className="relative mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap gap-3">
          <button
            onClick={() => navigate(`/player/${id}?tab=career`)}
            className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15"
          >
            ← Back to Game Highs
          </button>
          <button
            onClick={() => navigate("/")}
            className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15"
          >
            Return Home
          </button>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/35 backdrop-blur-2xl animate-fade-up sm:p-8 lg:p-10">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Stat Highs</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Top 50 {statLabel} Games
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            {data.name} career game logs, sorted in descending numerical order.
          </p>

          {topEntries.length > 0 ? (
            <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/45">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm text-slate-200">
                  <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Rank</th>
                      <th className="px-4 py-3 font-medium">{statLabel}</th>
                      <th className="px-4 py-3 font-medium">Season</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Matchup</th>
                      <th className="px-4 py-3 font-medium">Result</th>
                      <th className="px-4 py-3 font-medium">Game Log</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topEntries.map((entry, index) => (
                      <tr key={`${entry.seasonId}-${entry.game.game_id || entry.game.game_date || index}`} className="border-t border-white/8">
                        <td className="px-4 py-3 text-slate-300">{index + 1}</td>
                        <td className="px-4 py-3 font-semibold text-white">{formatValue(resolvedStatKey, entry.value)}</td>
                        <td className="px-4 py-3 text-slate-300">{entry.seasonId}</td>
                        <td className="px-4 py-3 text-slate-300">{formatDisplayDate(entry.game)}</td>
                        <td className="px-4 py-3 text-white">{entry.game.matchup || "-"}</td>
                        <td className="px-4 py-3 text-slate-300">{entry.game.result || "-"}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openGameSummary(entry)}
                            className="rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-300 hover:bg-white/15"
                          >
                            View Game
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-[1.25rem] border border-dashed border-white/12 bg-slate-900/35 p-6 text-sm text-slate-400">
              No cached game logs are available yet for this player.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
