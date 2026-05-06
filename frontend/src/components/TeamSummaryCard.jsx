import { useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { API_BASE } from "../api"

function getFavoritesCacheKey(token) {
  return token ? `netric:favorites:${token}` : null
}

function getTeamId(team) {
  return Number(team?.id ?? team?.team_id)
}

function normalizeTeam(team) {
  const teamId = getTeamId(team)

  return {
    id: teamId,
    name: team?.name,
    abbreviation: team?.abbreviation,
    city: team?.city,
    nickname: team?.nickname,
  }
}

function addFavoriteToCache(token, team) {
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
    const nextTeam = normalizeTeam(team)

    if (existingTeams.some(existingTeam => getTeamId(existingTeam) === nextTeam.id)) {
      return
    }

    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        timestamp: Date.now(),
        data: {
          players: Array.isArray(data.players) ? data.players : [],
          teams: [...existingTeams, nextTeam],
          stats: Array.isArray(data.stats) ? data.stats : [],
        },
      })
    )
  } catch (error) {
    console.error("Failed to update favorites cache", error)
  }
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

    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        timestamp: Date.now(),
        data: {
          players: Array.isArray(data.players) ? data.players : [],
          teams: existingTeams.filter(team => getTeamId(team) !== teamId),
          stats: Array.isArray(data.stats) ? data.stats : [],
        },
      })
    )
  } catch (error) {
    console.error("Failed to update favorites cache", error)
  }
}

function isTeamFavorited(token, teamId) {
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
    const teams = Array.isArray(parsedCache?.data?.teams) ? parsedCache.data.teams : []

    return teams.some(team => getTeamId(team) === teamId)
  } catch (error) {
    console.error("Failed to read favorites cache", error)
    return false
  }
}

export default function TeamSummaryCard({
  team,
  onRemoved,
  onMoveToTop,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragged = false,
  isDragTarget = false,
  isDraggable = true,
  canMoveToTop = false,
  showFavoriteActions = true,
}) {
  const navigate = useNavigate()
  const token = typeof window !== "undefined" ? window.localStorage.getItem("token") : null
  const teamId = getTeamId(team)
  const [isFavorited, setIsFavorited] = useState(() => isTeamFavorited(token, teamId))
  const displayTeam = normalizeTeam(team)
  const displayName = displayTeam.name || "NBA Team"
  const city = displayTeam.city || displayName.split(" ").slice(0, -1).join(" ")
  const nickname = displayTeam.nickname || displayName.split(" ").slice(-1).join("")

  async function handleFavorite(event) {
    event.stopPropagation()

    try {
      if (isFavorited) {
        await axios.delete(`${API_BASE}/favorites/team/${teamId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        removeFavoriteFromCache(token, teamId)
        setIsFavorited(false)
        onRemoved?.(teamId)
      } else {
        await axios.post(
          `${API_BASE}/favorite/teams`,
          displayTeam,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        )

        addFavoriteToCache(token, displayTeam)
        setIsFavorited(true)
      }
    } catch (error) {
      console.error(error)
      window.alert(isFavorited ? "Error removing favorite" : "Error favoriting team")
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={isDraggable}
      onClick={() => navigate(`/teams/${teamId}`)}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          navigate(`/teams/${teamId}`)
        }
      }}
      onDragStart={() => isDraggable && onDragStart?.(teamId)}
      onDragOver={event => {
        if (!isDraggable) {
          return
        }

        event.preventDefault()
        onDragOver?.(teamId)
      }}
      onDrop={event => {
        if (!isDraggable) {
          return
        }

        event.preventDefault()
        onDrop?.(teamId)
      }}
      onDragEnd={() => isDraggable && onDragEnd?.()}
      className={`group cursor-pointer overflow-hidden rounded-[1.5rem] border bg-slate-900/60 p-5 shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:border-white/20 ${
        isDragged ? "scale-[0.98] opacity-50" : ""
      } ${
        isDragTarget ? "border-emerald-300/60 ring-2 ring-emerald-300/25" : "border-white/10"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.22em] text-emerald-200">{displayTeam.abbreviation || "NBA"}</p>
          <h2 className="mt-3 truncate text-2xl font-semibold text-white">{displayName}</h2>
          <p className="mt-1 text-sm text-slate-400">{city}</p>
        </div>

        <div className="shrink-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Team</p>
          <p className="mt-1 text-sm font-semibold text-white">{nickname}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {showFavoriteActions && (
          <button
            type="button"
            onClick={handleFavorite}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-300 ${
              isFavorited
                ? "bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-400/20 hover:bg-emerald-300"
                : "bg-amber-400 text-slate-950 hover:bg-amber-300"
            }`}
          >
            {isFavorited ? "Favorited" : "Favorite"}
          </button>
        )}

        {canMoveToTop && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation()
              onMoveToTop?.(teamId)
            }}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition-all duration-300 hover:bg-white/10 hover:text-white"
          >
            Move to top
          </button>
        )}
      </div>
    </div>
  )
}
