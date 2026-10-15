import { useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { API_BASE } from "../api"

function getFavoritesCacheKey(token) {
  return token ? `netric:favorites:${token}` : null
}

function addFavoriteToCache(token, player) {
  if (typeof window === "undefined") {
    return
  }

  const cacheKey = getFavoritesCacheKey(token)

  if (!cacheKey) {
    return
  }

  try {
    const rawCache = window.localStorage.getItem(cacheKey)

    if (!rawCache) {
      return
    }

    const parsedCache = JSON.parse(rawCache)
    const data = parsedCache?.data ?? { players: [], teams: [], stats: [] }
    const existingPlayers = Array.isArray(data.players) ? data.players : []

    if (existingPlayers.some(existingPlayer => existingPlayer.id === player.id)) {
      return
    }

    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        timestamp: Date.now(),
        data: {
          players: [...existingPlayers, player],
          teams: Array.isArray(data.teams) ? data.teams : [],
          stats: Array.isArray(data.stats) ? data.stats : [],
        },
      })
    )
  } catch (error) {
    console.error("Failed to update favorites cache", error)
  }
}

function removeFavoriteFromCache(token, playerId) {
  if (typeof window === "undefined") {
    return
  }

  const cacheKey = getFavoritesCacheKey(token)

  if (!cacheKey) {
    return
  }

  try {
    const rawCache = window.localStorage.getItem(cacheKey)

    if (!rawCache) {
      return
    }

    const parsedCache = JSON.parse(rawCache)
    const data = parsedCache?.data ?? { players: [], teams: [], stats: [] }
    const existingPlayers = Array.isArray(data.players) ? data.players : []

    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        timestamp: Date.now(),
        data: {
          players: existingPlayers.filter(player => player.id !== playerId),
          teams: Array.isArray(data.teams) ? data.teams : [],
          stats: Array.isArray(data.stats) ? data.stats : [],
        },
      })
    )
  } catch (error) {
    console.error("Failed to update favorites cache", error)
  }
}

function isPlayerFavorited(token, playerId) {
  if (typeof window === "undefined") {
    return false
  }

  const cacheKey = getFavoritesCacheKey(token)

  if (!cacheKey) {
    return false
  }

  try {
    const rawCache = window.localStorage.getItem(cacheKey)

    if (!rawCache) {
      return false
    }

    const parsedCache = JSON.parse(rawCache)
    const players = Array.isArray(parsedCache?.data?.players) ? parsedCache.data.players : []

    return players.some(player => player.id === playerId)
  } catch (error) {
    console.error("Failed to read favorites cache", error)
    return false
  }
}

export default function PlayerCard({
  player_id,
  name,
  season,
  season_stats,
  season_stats_by_season,
  last_game,
  headshot_url,
}) {
  const navigate = useNavigate()
  const token = typeof window !== "undefined" ? window.localStorage.getItem("token") : null
  const [isFavorited, setIsFavorited] = useState(() => isPlayerFavorited(token, player_id))
  const displaySeasonStats = season_stats_by_season?.[season] || season_stats

  function formatNumber(value, decimals = 1) {
    if (value == null || Number.isNaN(Number(value))) {
      return "0.0"
    }

    return Number(value).toFixed(decimals)
  }

  function formatStat(stat, decimals = 1) {
    if (!displaySeasonStats?.gp || displaySeasonStats.gp === 0) {
      return "0.0"
    }

    if (stat == null || Number.isNaN(Number(stat))) {
      return "0.0"
    }

    return (Number(stat) / Number(displaySeasonStats.gp)).toFixed(decimals)
  }

  function formatPct(stat, decimals = 1) {
    if (stat == null || Number.isNaN(Number(stat))) {
      return "0.0"
    }

    return Number(Number(stat) * 100).toFixed(decimals)
  }

  function calculatePct(makes, attempts, decimals = 1) {
    if (!attempts || Number(attempts) === 0) {
      return "0.0"
    }

    return Number((Number(makes) / Number(attempts)) * 100).toFixed(decimals)
  }

  const handleFavorite = async event => {
    event.stopPropagation()

    try {
      if (isFavorited) {
        await axios.delete(`${API_BASE}/favorites/player/${player_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        removeFavoriteFromCache(token, player_id)
        setIsFavorited(false)
      } else {
        await axios.post(
          `${API_BASE}/favorite/players`,
          { id: player_id, name },
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        )

        addFavoriteToCache(token, { id: player_id, name })
        setIsFavorited(true)
      }
    } catch (err) {
      console.error(err)
      window.alert(isFavorited ? "Error removing favorite" : "Error favoriting player")
    }
  }

  if (!displaySeasonStats) {
    return null
  }

  return (
    <div
      onClick={() => navigate(`/player/${player_id}`)}
      className="cursor-pointer overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-900/60 p-6 shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:border-white/20"
    >
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex flex-col items-start gap-4 lg:w-64">
          <div className="rounded-[1.5rem] bg-blue-400/20 p-2">
            <img
              src={headshot_url}
              alt={name}
              className="h-48 w-48 rounded-[1.25rem] border border-white/15 object-cover shadow-lg shadow-black/20"
            />
          </div>

          <div className="w-full pl-3 text-left">
            <h2 className="text-2xl font-semibold text-white">{name}</h2>
            <p className="mt-2 text-sm text-slate-300">{season}</p>
          </div>

          <button
            onClick={handleFavorite}
            className={`ml-3 rounded-xl px-5 py-3 text-sm font-medium transition-all duration-300 ${
              isFavorited
                ? "bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-400/20 hover:-translate-y-0.5 hover:bg-emerald-300"
                : "bg-amber-400 text-slate-950 hover:-translate-y-0.5 hover:bg-amber-300"
            }`}
          >
            {isFavorited ? "✓ Favorited" : "Favorite"}
          </button>
        </div>

        <div className="flex-1 space-y-5">
          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Season Averages</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">PTS</p>
                <p className="mt-2 text-base font-semibold text-white">{formatStat(displaySeasonStats.pts)}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">AST</p>
                <p className="mt-2 text-base font-semibold text-white">{formatStat(displaySeasonStats.ast)}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">REB</p>
                <p className="mt-2 text-base font-semibold text-white">{formatStat(displaySeasonStats.reb)}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">STL</p>
                <p className="mt-2 text-sm font-medium text-slate-200">{formatStat(displaySeasonStats.stl)}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">BLK</p>
                <p className="mt-2 text-sm font-medium text-slate-200">{formatStat(displaySeasonStats.blk)}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">TOV</p>
                <p className="mt-2 text-sm font-medium text-slate-200">{formatStat(displaySeasonStats.tov)}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">MIN</p>
                <p className="mt-2 text-sm font-medium text-slate-200">{formatStat(displaySeasonStats.min_total)}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Shooting Splits</p>
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">FG%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">{formatPct(displaySeasonStats.fg_pct)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">3FG%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">{formatPct(displaySeasonStats.fg3_pct)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">FT%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">
                    {calculatePct(displaySeasonStats.ftm, displaySeasonStats.fta)}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">2FG%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">
                    {calculatePct(displaySeasonStats.fg2pm, displaySeasonStats.fg2pa)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">TS%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">{formatPct(displaySeasonStats.ts_pct)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">eFG%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">{formatPct(displaySeasonStats.efg_pct)}</p>
                </div>
              </div>
            </div>
          </div>

          {last_game && (
            <div className="rounded-2xl border border-white/10 bg-blue-500/10 px-5 py-4">
              <p className="text-xs uppercase tracking-[0.22em] text-emerald-100">Last Game</p>
              <h3 className="mt-2 text-lg font-semibold text-white">{last_game.matchup}</h3>
              <p className="mt-1 text-xs text-slate-300">{last_game.date}</p>
              <p className="mt-3 text-sm text-slate-200">
                {formatNumber(last_game.pts, 0)} PTS / {formatNumber(last_game.ast, 0)} AST / {formatNumber(last_game.reb, 0)} REB
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
