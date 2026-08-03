import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { API_BASE } from "../api"
import { formatTeamValue } from "../utils/teamStats"

const CONTEXT_MENU_WIDTH = 224
const CONTEXT_MENU_PADDING = 16
const TEAM_SUMMARY_CACHE_TTL = 1000 * 60 * 15
const TEAM_SUMMARY_DATA_VERSION = 1

function getTeamId(team) {
  return Number(team?.id ?? team?.team_id)
}

function getTeamSummaryCacheKey(teamId) {
  return Number.isFinite(Number(teamId)) ? `netric:team-summary:${TEAM_SUMMARY_DATA_VERSION}:${teamId}` : null
}

function readTeamSummaryCache(teamId) {
  if (typeof window === "undefined") {
    return null
  }

  const cacheKey = getTeamSummaryCacheKey(teamId)

  if (!cacheKey) {
    return null
  }

  try {
    const rawCache = window.localStorage.getItem(cacheKey)

    if (!rawCache) {
      return null
    }

    const parsedCache = JSON.parse(rawCache)

    if (!parsedCache?.data || Date.now() - Number(parsedCache.timestamp || 0) > TEAM_SUMMARY_CACHE_TTL) {
      window.localStorage.removeItem(cacheKey)
      return null
    }

    return parsedCache.data
  } catch (error) {
    console.error("Failed to read team summary cache", error)
    return null
  }
}

function writeTeamSummaryCache(teamId, summary) {
  if (typeof window === "undefined") {
    return
  }

  const cacheKey = getTeamSummaryCacheKey(teamId)

  if (!cacheKey) {
    return
  }

  try {
    window.localStorage.setItem(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      data: summary,
    }))
  } catch (error) {
    console.error("Failed to write team summary cache", error)
  }
}

function getFavoritesCacheKey(token) {
  return token ? `netric:favorites:${token}` : null
}

function removeFavoriteFromCache(token, teamId) {
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
    const existingTeams = Array.isArray(data.teams) ? data.teams : []

    window.localStorage.setItem(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      data: {
        players: Array.isArray(data.players) ? data.players : [],
        teams: existingTeams.filter(team => getTeamId(team) !== teamId),
        stats: Array.isArray(data.stats) ? data.stats : [],
      },
    }))
  } catch (error) {
    console.error("Failed to update favorites cache", error)
  }
}

function normalizeTeam(team) {
  const name = team?.name || "NBA Team"

  return {
    id: getTeamId(team),
    name,
    abbreviation: team?.abbreviation || "NBA",
    city: team?.city || name.split(" ").slice(0, -1).join(" "),
    nickname: team?.nickname || name.split(" ").slice(-1).join(""),
  }
}

function getLogoUrl(teamId) {
  return Number.isFinite(Number(teamId)) ? `https://cdn.nba.com/logos/nba/${teamId}/primary/L/logo.svg` : ""
}

export default function TeamFavoriteCard({
  team,
  onRemoved,
  onMoveToTop,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragged = false,
  isDragTarget = false,
  canMoveToTop = true,
  isDraggable = true,
}) {
  const navigate = useNavigate()
  const token = typeof window !== "undefined" ? window.localStorage.getItem("token") : null
  const teamId = getTeamId(team)
  const initialSummary = readTeamSummaryCache(teamId)
  const cardRef = useRef(null)
  const shouldSuppressClickRef = useRef(false)
  const [summary, setSummary] = useState(initialSummary)
  const [loading, setLoading] = useState(() => !initialSummary)
  const [error, setError] = useState("")
  const [contextMenu, setContextMenu] = useState(null)
  const displayTeam = normalizeTeam(summary?.team || team)
  const stats = summary?.stats || {}
  const statItems = [
    { key: "pts", label: "PPG", type: "number" },
    { key: "ast", label: "APG", type: "number" },
    { key: "reb", label: "RPG", type: "number" },
    { key: "fg_pct", label: "FG%", type: "percentage" },
    { key: "fg3_pct", label: "3PFG%", type: "percentage" },
    { key: "ft_pct", label: "FT%", type: "percentage" },
  ]

  useEffect(() => {
    const cachedSummary = readTeamSummaryCache(teamId)

    if (cachedSummary) {
      setSummary(cachedSummary)
      setLoading(false)
      setError("")
      return undefined
    }

    let ignore = false

    async function fetchSummary() {
      try {
        const res = await axios.get(`${API_BASE}/teams/${teamId}/summary`)

        if (ignore) {
          return
        }

        setSummary(res.data)
        setError("")
        writeTeamSummaryCache(teamId, res.data)
      } catch (err) {
        if (ignore) {
          return
        }

        setError(err?.response?.status === 404 ? "Queued" : "Unavailable")
        console.error(err)
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    fetchSummary()

    return () => {
      ignore = true
    }
  }, [teamId])

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

  async function removeFavorite() {
    try {
      await axios.delete(`${API_BASE}/favorites/team/${teamId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      setContextMenu(null)
      removeFavoriteFromCache(token, teamId)
      onRemoved?.(teamId)
    } catch (err) {
      console.error("Failed to remove favorite team", err)
    }
  }

  if (loading && !summary) {
    return (
      <div className="rounded-[1.75rem] border border-white/10 bg-slate-900/55 p-6 shadow-lg shadow-black/20 animate-content-in">
        <div className="mb-4 h-12 w-12 rounded-full border-4 border-emerald-400/30 border-t-emerald-400 animate-spin" />
        <h2 className="text-xl font-semibold text-white">{displayTeam.name}</h2>
        <p className="mt-2 text-sm text-slate-300">Loading team...</p>
      </div>
    )
  }

  return (
    <div
      ref={cardRef}
      draggable={isDraggable}
      onMouseLeave={() => setContextMenu(null)}
      onClick={() => {
        if (shouldSuppressClickRef.current) {
          shouldSuppressClickRef.current = false
          return
        }

        setContextMenu(null)
        navigate(`/teams/${teamId}`)
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

        setContextMenu({ left: nextLeft, top: nextTop })
      }}
      onDragStart={event => {
        if (!isDraggable) {
          event.preventDefault()
          return
        }

        shouldSuppressClickRef.current = true
        setContextMenu(null)
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", String(teamId))
        onDragStart?.(teamId)
      }}
      onDragOver={event => {
        if (!isDraggable) {
          return
        }

        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        onDragOver?.(teamId)
      }}
      onDrop={event => {
        if (!isDraggable) {
          return
        }

        event.preventDefault()
        onDrop?.(teamId)
      }}
      onDragEnd={() => {
        if (!isDraggable) {
          return
        }

        window.setTimeout(() => {
          shouldSuppressClickRef.current = false
        }, 0)
        onDragEnd?.()
      }}
      className={`relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-900/60 p-6 shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-slate-900/75 ${
        isDraggable ? "cursor-grab" : "cursor-pointer"
      } ${
        isDragged ? "scale-[0.985] opacity-70" : ""
      } ${isDragTarget ? "border-emerald-300/40 shadow-xl shadow-emerald-500/10" : ""}`}
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
                onMoveToTop?.(teamId)
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
            <img
              src={getLogoUrl(teamId)}
              alt={displayTeam.name}
              className="h-24 w-24 rounded-[1.25rem] border border-white/15 bg-white object-contain p-2 shadow-lg shadow-black/20"
            />
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">{displayTeam.abbreviation}</p>
              <h2 className="mt-2 text-xl font-semibold text-white">{displayTeam.name}</h2>
              <p className="mt-2 text-sm text-slate-300">Season {summary?.season || "N/A"}</p>
              {error && <p className="mt-1 text-xs uppercase tracking-[0.2em] text-amber-200">{error}</p>}
            </div>
          </div>
        </div>

        <div className="flex-1 rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Team Averages</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {statItems.map(stat => (
              <div key={stat.key} className="min-w-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{stat.label}</p>
                <p className="mt-2 text-base font-semibold text-white">{formatTeamValue(stats?.[stat.key], stat.type)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
