import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { API_BASE } from "../api"
import {
  clearPlayerSummaryCache,
  readPlayerSummaryCache,
  writePlayerSummaryCache,
} from "../utils/playerSummaryCache"

const CONTEXT_MENU_WIDTH = 224
const CONTEXT_MENU_PADDING = 16

function getGameTimestamp(game) {
  const rawDate = game?.game_date || game?.date

  if (!rawDate) {
    return null
  }

  const timestamp = new Date(rawDate).getTime()

  return Number.isNaN(timestamp) ? null : timestamp
}

function getGameDisplayDate(game) {
  return game?.date || game?.game_date || "Date unavailable"
}

function getFirstGameLogEntry(games) {
  return Array.isArray(games) && games.length > 0 ? games[0] : null
}

function getFirstSeasonGameLogEntry(seasonGameLogs) {
  if (!seasonGameLogs || typeof seasonGameLogs !== "object") {
    return null
  }

  return Object.values(seasonGameLogs)
    .flatMap(games => (Array.isArray(games) ? games : []))
    .sort((leftGame, rightGame) => (getGameTimestamp(rightGame) || 0) - (getGameTimestamp(leftGame) || 0))[0] || null
}

function getLastGameDisplay(summary) {
  const regularLastGame = summary?.last_game || null
  const postseasonCandidates = [
    summary?.playoff_last_game,
    summary?.playin_last_game,
    getFirstGameLogEntry(summary?.playoff_season_game_log),
    getFirstGameLogEntry(summary?.playin_season_game_log),
    getFirstSeasonGameLogEntry(summary?.playoff_season_game_logs),
    getFirstSeasonGameLogEntry(summary?.playin_season_game_logs),
  ].filter(Boolean)
  const postseasonLastGame = postseasonCandidates
    .sort((leftGame, rightGame) => (getGameTimestamp(rightGame) || 0) - (getGameTimestamp(leftGame) || 0))[0] || null

  if (!postseasonLastGame) {
    return regularLastGame ? { game: regularLastGame, isPostseason: false } : null
  }

  if (!regularLastGame) {
    return { game: postseasonLastGame, isPostseason: true }
  }

  const postseasonTimestamp = getGameTimestamp(postseasonLastGame)
  const regularTimestamp = getGameTimestamp(regularLastGame)

  if (postseasonTimestamp != null && regularTimestamp != null) {
    return postseasonTimestamp > regularTimestamp
      ? { game: postseasonLastGame, isPostseason: true }
      : { game: regularLastGame, isPostseason: false }
  }

  return { game: regularLastGame, isPostseason: false }
}

export default function PlayerSummaryCard({
  player,
  onRemoved,
  onSummaryLoaded,
  onMoveToTop,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragged = false,
  isDragTarget = false,
  canMoveToTop = true,
}) {
  const navigate = useNavigate()
  const token = typeof window !== "undefined" ? window.localStorage.getItem("token") : null
  const initialSummary = readPlayerSummaryCache(player.id)
  const cardRef = useRef(null)
  const shouldSuppressClickRef = useRef(false)

  const [summary, setSummary] = useState(initialSummary)
  const [loading, setLoading] = useState(() => !initialSummary)
  const [notCached, setNotCached] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const displaySeasonStats = summary?.season_stats_by_season?.[summary?.season] || summary?.season_stats
  const lastGameDisplay = getLastGameDisplay(summary)
  const lastGame = lastGameDisplay?.game || null

  useEffect(() => {
    const cachedSummary = readPlayerSummaryCache(player.id)

    if (cachedSummary) {
      setSummary(cachedSummary)
      setLoading(false)
      setNotCached(false)
      return undefined
    }

    let intervalId
    let ignore = false

    const fetchSummary = async () => {
      try {
        const res = await axios.get(`${API_BASE}/player/${player.id}/summary`)

        if (ignore) {
          return
        }

        setSummary(res.data)
        setLoading(false)
        setNotCached(false)
        writePlayerSummaryCache(player.id, res.data)

        if (intervalId) {
          clearInterval(intervalId)
        }
      } catch (err) {
        if (ignore) {
          return
        }

        if (err.response?.status === 404) {
          setLoading(false)

          if (!readPlayerSummaryCache(player.id)) {
            setNotCached(true)
          }

          if (!intervalId) {
            intervalId = setInterval(fetchSummary, 5000)
          }
        } else {
          setLoading(false)
          console.error(err)
        }
      }
    }

    fetchSummary()

    return () => {
      ignore = true

      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [player.id])

  useEffect(() => {
    if (summary && onSummaryLoaded) {
      onSummaryLoaded(player.id, summary)
    }
  }, [onSummaryLoaded, player.id, summary])

  useEffect(() => {
    if (!contextMenu) {
      return undefined
    }

    function closeContextMenu() {
      setContextMenu(null)
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setContextMenu(null)
      }
    }

    window.addEventListener("click", closeContextMenu)
    window.addEventListener("scroll", closeContextMenu, true)
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("click", closeContextMenu)
      window.removeEventListener("scroll", closeContextMenu, true)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [contextMenu])

  useEffect(() => {
    function resetTransientState() {
      setContextMenu(null)
      shouldSuppressClickRef.current = false
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        resetTransientState()
      }
    }

    window.addEventListener("pageshow", resetTransientState)
    window.addEventListener("pagehide", resetTransientState)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.removeEventListener("pageshow", resetTransientState)
      window.removeEventListener("pagehide", resetTransientState)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

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

  async function removeFavorite() {
    try {
      await axios.delete(`${API_BASE}/favorites/player/${player.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      clearPlayerSummaryCache(player.id)
      setContextMenu(null)

      if (onRemoved) {
        onRemoved(player.id)
      }
    } catch (err) {
      console.error("Failed to remove favorite", err)
    }
  }

  if (loading && !summary) {
    return (
      <div className="rounded-[1.75rem] border border-white/10 bg-slate-900/55 p-6 shadow-lg shadow-black/20 animate-content-in">
        <div className="mb-4 h-12 w-12 rounded-full border-4 border-blue-400/30 border-t-blue-400 animate-spin" />
        <h2 className="text-xl font-semibold text-white">{player.name}</h2>
        <p className="mt-2 text-sm text-slate-300">Loading player…</p>
      </div>
    )
  }

  if (notCached && !summary) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-white/15 bg-slate-900/45 p-6 text-slate-300 animate-content-in">
        <h2 className="text-xl font-semibold text-white">{player.name}</h2>
        <p className="mt-2 text-sm">This player has not been loaded yet.</p>
      </div>
    )
  }

  return (
    <div
      ref={cardRef}
      draggable
      onMouseLeave={() => setContextMenu(null)}
      onClick={() => {
        if (shouldSuppressClickRef.current) {
          shouldSuppressClickRef.current = false
          return
        }

        setContextMenu(null)
        navigate(`/player/${player.id}`)
      }}
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
        const cardBounds = cardRef.current?.getBoundingClientRect()

        if (!cardBounds) {
          return
        }

        const maxLeft = Math.max(CONTEXT_MENU_PADDING, cardBounds.width - CONTEXT_MENU_WIDTH - CONTEXT_MENU_PADDING)
        const nextLeft = Math.min(Math.max(event.clientX - cardBounds.left, CONTEXT_MENU_PADDING), maxLeft)
        const nextTop = Math.min(
          Math.max(event.clientY - cardBounds.top, CONTEXT_MENU_PADDING),
          Math.max(CONTEXT_MENU_PADDING, cardBounds.height - 72)
        )

        setContextMenu({
          left: nextLeft,
          top: nextTop,
        })
      }}
      onDragStart={event => {
        shouldSuppressClickRef.current = true
        setContextMenu(null)
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", String(player.id))

        if (onDragStart) {
          onDragStart(player.id)
        }
      }}
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"

        if (onDragOver) {
          onDragOver(player.id)
        }
      }}
      onDrop={event => {
        event.preventDefault()

        if (onDrop) {
          onDrop(player.id)
        }
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          shouldSuppressClickRef.current = false
        }, 0)

        if (onDragEnd) {
          onDragEnd()
        }
      }}
      className={`relative cursor-grab overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-900/60 p-6 shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-slate-900/75 ${
        isDragged ? "scale-[0.985] opacity-70" : ""
      } ${isDragTarget ? "border-blue-300/40 shadow-xl shadow-blue-500/10" : ""}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />

      {contextMenu && (
        <div
          className="absolute z-50 min-w-56 rounded-xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl shadow-black/35 backdrop-blur-xl"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onClick={event => event.stopPropagation()}
          onContextMenu={event => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          {canMoveToTop && (
            <button
              onClick={event => {
                event.stopPropagation()
                setContextMenu(null)

                if (onMoveToTop) {
                  onMoveToTop(player.id)
                }
              }}
              className="mb-1 w-full rounded-lg px-3 py-2 text-left text-sm text-slate-100 transition-colors duration-200 hover:bg-white/10"
            >
              Move to top
            </button>
          )}
          <button
            onClick={event => {
              event.stopPropagation()
              removeFavorite()
            }}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-100 transition-colors duration-200 hover:bg-red-500/15"
          >
            Remove from favorites
          </button>
        </div>
      )}

      <div className="relative flex flex-col gap-5 xl:flex-row">
        <div className="xl:w-[15rem] xl:shrink-0">
          <div className="flex items-center gap-4 xl:flex-col xl:items-start">
            {summary?.headshot_url && (
              <img
                src={summary.headshot_url}
                alt={player.name}
                className="h-24 w-24 rounded-[1.25rem] border border-white/15 object-cover shadow-lg shadow-black/20"
              />
            )}

            <div>
              <h2 className="text-xl font-semibold text-white">{player.name}</h2>
              <p className="mt-2 text-sm text-slate-300">Season {summary.season}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                {formatNumber(displaySeasonStats?.gp, 0)} games
              </p>
            </div>
          </div>

          {lastGame && (
            <button
              onClick={event => {
                event.stopPropagation()
                setContextMenu(null)
                const gameLogParams = new URLSearchParams({
                  tab: "games",
                  season: summary.season,
                })

                if (lastGameDisplay.isPostseason) {
                  gameLogParams.set("postseason", "1")
                }

                navigate(`/player/${player.id}?${gameLogParams.toString()}`)
              }}
              className="mt-4 w-full max-w-[13.5rem] rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/10 to-emerald-400/10 px-4 py-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-300/25 hover:from-blue-500/15 hover:to-emerald-400/15"
            >
              <p className="text-xs uppercase tracking-[0.22em] text-emerald-100">
                {lastGameDisplay.isPostseason ? "Last Game - PS" : "Last Game"}
              </p>
              <p className="mt-2 text-sm text-white">{lastGame.matchup}</p>
              <p className="mt-1 text-xs text-slate-300">{getGameDisplayDate(lastGame)}</p>
              <p className="mt-3 text-sm text-slate-200">
                {formatNumber(lastGame.pts, 0)} PTS / {formatNumber(lastGame.ast, 0)} AST / {formatNumber(lastGame.reb, 0)} REB
              </p>
            </button>
          )}
        </div>

        <div className="flex-1 space-y-4">
          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Season Averages</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">PTS</p>
                <p className="mt-2 text-base font-semibold text-white">{formatStat(displaySeasonStats?.pts)}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">AST</p>
                <p className="mt-2 text-base font-semibold text-white">{formatStat(displaySeasonStats?.ast)}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">REB</p>
                <p className="mt-2 text-base font-semibold text-white">{formatStat(displaySeasonStats?.reb)}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">STL</p>
                <p className="mt-2 text-sm font-medium text-slate-200">{formatStat(displaySeasonStats?.stl)}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">BLK</p>
                <p className="mt-2 text-sm font-medium text-slate-200">{formatStat(displaySeasonStats?.blk)}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">TOV</p>
                <p className="mt-2 text-sm font-medium text-slate-200">{formatStat(displaySeasonStats?.tov)}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">MIN</p>
                <p className="mt-2 text-sm font-medium text-slate-200">{formatStat(displaySeasonStats?.min_total)}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Shooting Splits</p>
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">FG%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">{formatPct(displaySeasonStats?.fg_pct)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">3FG%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">{formatPct(displaySeasonStats?.fg3_pct)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">FT%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">
                    {calculatePct(displaySeasonStats?.ftm, displaySeasonStats?.fta)}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">2FG%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">
                    {calculatePct(displaySeasonStats?.fg2pm, displaySeasonStats?.fg2pa)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">TS%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">{formatPct(displaySeasonStats?.ts_pct)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">eFG%</p>
                  <p className="mt-2 text-sm font-medium text-slate-200">{formatPct(displaySeasonStats?.efg_pct)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
