import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import PlayerSummaryCard from "../components/PlayerSummaryCard"
import { API_BASE } from "../api"
import { readPlayerSummaryCache } from "../utils/playerSummaryCache"
import { normalizeSearchFilter } from "../utils/searchText"

const EMPTY_FAVORITES = {
  players: [],
  teams: [],
  stats: [],
}

const FAVORITES_CACHE_TTL = 1000 * 60 * 15
const TEAM_ALIASES_BY_ABBREVIATION = {
  ATL: ["Atlanta Hawks", "Hawks", "Atlanta"],
  BKN: ["Brooklyn Nets", "Nets", "Brooklyn"],
  BOS: ["Boston Celtics", "Celtics", "Boston"],
  CHA: ["Charlotte Hornets", "Hornets", "Charlotte"],
  CHI: ["Chicago Bulls", "Bulls", "Chicago"],
  CLE: ["Cleveland Cavaliers", "Cavaliers", "Cavs", "Cleveland"],
  DAL: ["Dallas Mavericks", "Mavericks", "Mavs", "Dallas"],
  DEN: ["Denver Nuggets", "Nuggets", "Denver"],
  DET: ["Detroit Pistons", "Pistons", "Detroit"],
  GSW: ["Golden State Warriors", "Warriors", "Golden State"],
  HOU: ["Houston Rockets", "Rockets", "Houston"],
  IND: ["Indiana Pacers", "Pacers", "Indiana"],
  LAC: ["Los Angeles Clippers", "Clippers", "LA Clippers", "Los Angeles"],
  LAL: ["Los Angeles Lakers", "Lakers", "LA Lakers", "Los Angeles"],
  MEM: ["Memphis Grizzlies", "Grizzlies", "Memphis"],
  MIA: ["Miami Heat", "Heat", "Miami"],
  MIL: ["Milwaukee Bucks", "Bucks", "Milwaukee"],
  MIN: ["Minnesota Timberwolves", "Timberwolves", "Wolves", "Minnesota"],
  NOP: ["New Orleans Pelicans", "Pelicans", "New Orleans"],
  NYK: ["New York Knicks", "Knicks", "New York"],
  OKC: ["Oklahoma City Thunder", "Thunder", "Oklahoma City"],
  ORL: ["Orlando Magic", "Magic", "Orlando"],
  PHI: ["Philadelphia 76ers", "76ers", "Sixers", "Philadelphia"],
  PHX: ["Phoenix Suns", "Suns", "Phoenix"],
  POR: ["Portland Trail Blazers", "Trail Blazers", "Blazers", "Portland"],
  SAC: ["Sacramento Kings", "Kings", "Sacramento"],
  SAS: ["San Antonio Spurs", "Spurs", "San Antonio"],
  TOR: ["Toronto Raptors", "Raptors", "Toronto"],
  UTA: ["Utah Jazz", "Jazz", "Utah"],
  WAS: ["Washington Wizards", "Wizards", "Washington"],
}
const PLAYER_SORT_OPTIONS = [
  { value: "pts", label: "PTS" },
  { value: "ast", label: "AST" },
  { value: "reb", label: "REB" },
  { value: "stl", label: "STL" },
  { value: "blk", label: "BLK" },
  { value: "tov", label: "TOV" },
  { value: "min_total", label: "MIN" },
  { value: "fg_pct", label: "FG%" },
  { value: "fg3_pct", label: "3FG%" },
  { value: "ft_pct", label: "FT%" },
  { value: "ts_pct", label: "TS%" },
  { value: "efg_pct", label: "eFG%" },
]
const PERCENTAGE_SORT_STATS = new Set(["fg_pct", "fg3_pct", "ft_pct", "ts_pct", "efg_pct"])

function getDisplaySeasonStats(summary) {
  return summary?.season_stats_by_season?.[summary?.season] || summary?.season_stats || null
}

function getSortStatValue(summary, statKey) {
  const seasonStats = getDisplaySeasonStats(summary)

  if (!seasonStats) {
    return null
  }

  if (statKey === "ft_pct") {
    const makes = Number(seasonStats.ftm)
    const attempts = Number(seasonStats.fta)

    if (!Number.isFinite(makes) || !Number.isFinite(attempts) || attempts <= 0) {
      return null
    }

    return makes / attempts
  }

  const rawValue = Number(seasonStats[statKey])

  if (!Number.isFinite(rawValue)) {
    return null
  }

  if (PERCENTAGE_SORT_STATS.has(statKey)) {
    return rawValue
  }

  const gamesPlayed = Number(seasonStats.gp)

  if (!Number.isFinite(gamesPlayed) || gamesPlayed <= 0) {
    return null
  }

  return rawValue / gamesPlayed
}

function normalizeFavorites(data = {}) {
  return {
    players: Array.isArray(data.players) ? data.players : [],
    teams: Array.isArray(data.teams) ? data.teams : [],
    stats: Array.isArray(data.stats) ? data.stats : [],
  }
}

function getTeamDisplayName(abbreviation) {
  const normalizedAbbreviation = String(abbreviation || "").toUpperCase()
  const aliases = TEAM_ALIASES_BY_ABBREVIATION[normalizedAbbreviation]

  return aliases?.[0] || normalizedAbbreviation
}

function getFavoritesCacheKey(token) {
  return token ? `netric:favorites:${token}` : null
}

function getPlayerOrderCacheKey(token) {
  return token ? `netric:favorites:player-order:${token}` : null
}

function readPlayerOrder(token) {
  if (typeof window === "undefined") {
    return []
  }

  const cacheKey = getPlayerOrderCacheKey(token)

  if (!cacheKey) {
    return []
  }

  try {
    const rawOrder = window.localStorage.getItem(cacheKey)
    const parsedOrder = rawOrder ? JSON.parse(rawOrder) : []

    return Array.isArray(parsedOrder) ? parsedOrder : []
  } catch (error) {
    console.error("Failed to read player order cache", error)
    return []
  }
}

function writePlayerOrder(token, playerIds) {
  if (typeof window === "undefined") {
    return
  }

  const cacheKey = getPlayerOrderCacheKey(token)

  if (!cacheKey) {
    return
  }

  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(playerIds))
  } catch (error) {
    console.error("Failed to write player order cache", error)
  }
}

function applyPlayerOrder(players, orderedIds) {
  if (!orderedIds.length) {
    return players
  }

  const orderMap = new Map(orderedIds.map((id, index) => [id, index]))

  return [...players].sort((left, right) => {
    const leftRank = orderMap.has(left.id) ? orderMap.get(left.id) : Number.POSITIVE_INFINITY
    const rightRank = orderMap.has(right.id) ? orderMap.get(right.id) : Number.POSITIVE_INFINITY

    if (leftRank === rightRank) {
      return 0
    }

    return leftRank - rightRank
  })
}

function readFavoritesCache(token) {
  if (typeof window === "undefined") {
    return EMPTY_FAVORITES
  }

  const cacheKey = getFavoritesCacheKey(token)

  if (!cacheKey) {
    return EMPTY_FAVORITES
  }

  try {
    const rawCache = window.localStorage.getItem(cacheKey)

    if (!rawCache) {
      return EMPTY_FAVORITES
    }

    const parsedCache = JSON.parse(rawCache)

    if (!parsedCache?.timestamp || Date.now() - parsedCache.timestamp > FAVORITES_CACHE_TTL) {
      window.localStorage.removeItem(cacheKey)
      return EMPTY_FAVORITES
    }

    const normalizedFavorites = normalizeFavorites(parsedCache.data)

    return {
      ...normalizedFavorites,
      players: applyPlayerOrder(normalizedFavorites.players, readPlayerOrder(token)),
    }
  } catch (error) {
    console.error("Failed to read favorites cache", error)
    return EMPTY_FAVORITES
  }
}

function writeFavoritesCache(token, favorites) {
  if (typeof window === "undefined") {
    return
  }

  const cacheKey = getFavoritesCacheKey(token)

  if (!cacheKey) {
    return
  }

  try {
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        timestamp: Date.now(),
        data: normalizeFavorites(favorites),
      })
    )
  } catch (error) {
    console.error("Failed to write favorites cache", error)
  }
}

function hasFavorites(favorites) {
  return (
    favorites.players.length > 0 ||
    favorites.teams.length > 0 ||
    favorites.stats.length > 0
  )
}

export default function Home() {
  const navigate = useNavigate()
  const token = typeof window !== "undefined" ? window.localStorage.getItem("token") : null
  const cachedFavorites = readFavoritesCache(token)

  const [activeTab, setActiveTab] = useState("players")
  const [favorites, setFavorites] = useState(cachedFavorites)
  const [loading, setLoading] = useState(() => !hasFavorites(cachedFavorites))
  const [refreshing, setRefreshing] = useState(() => hasFavorites(cachedFavorites))
  const [error, setError] = useState(null)
  const [draggedPlayerId, setDraggedPlayerId] = useState(null)
  const [dragOverPlayerId, setDragOverPlayerId] = useState(null)
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false)
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false)
  const [playerNameFilter, setPlayerNameFilter] = useState("")
  const [teamFilter, setTeamFilter] = useState("")
  const [sortCategory, setSortCategory] = useState("")
  const [sortDirection, setSortDirection] = useState("desc")
  const [draftPlayerNameFilter, setDraftPlayerNameFilter] = useState("")
  const [draftTeamFilter, setDraftTeamFilter] = useState("")
  const controlsMenuRef = useRef(null)
  const [playerSummaries, setPlayerSummaries] = useState(() =>
    cachedFavorites.players.reduce((summaries, player) => {
      const summary = readPlayerSummaryCache(player.id)

      if (summary) {
        summaries[player.id] = summary
      }

      return summaries
    }, {})
  )
  const [playerGridColumns, setPlayerGridColumns] = useState(() => {
    if (typeof window === "undefined") {
      return 1
    }

    return window.innerWidth >= 1700 ? 2 : 1
  })

  useEffect(() => {
    if (!token) {
      navigate("/login")
      return
    }

    let ignore = false

    setRefreshing(hasFavorites(readFavoritesCache(token)))

    axios
      .get(`${API_BASE}/favorites`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then(res => {
        if (ignore) {
          return
        }

        const nextFavorites = normalizeFavorites(res.data)
        const orderedFavorites = {
          ...nextFavorites,
          players: applyPlayerOrder(nextFavorites.players, readPlayerOrder(token)),
        }
        setFavorites(orderedFavorites)
        writeFavoritesCache(token, orderedFavorites)
        setError(null)
      })
      .catch(err => {
        if (ignore) {
          return
        }

        if (err?.response?.status === 401) {
          window.localStorage.removeItem("token")
          navigate("/login")
          return
        }

        setError("Unable to refresh favorites right now.")
        console.error(err)
      })
      .finally(() => {
        if (ignore) {
          return
        }

        setLoading(false)
        setRefreshing(false)
      })

    return () => {
      ignore = true
    }
  }, [navigate, token])

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined
    }

    function updatePlayerGridColumns() {
      setPlayerGridColumns(window.innerWidth >= 1700 ? 2 : 1)
    }

    updatePlayerGridColumns()
    window.addEventListener("resize", updatePlayerGridColumns)

    return () => {
      window.removeEventListener("resize", updatePlayerGridColumns)
    }
  }, [])

  useEffect(() => {
    if ((!isSortMenuOpen && !isFilterMenuOpen) || typeof window === "undefined") {
      return undefined
    }

    function handleOutsideClick(event) {
      if (!controlsMenuRef.current || controlsMenuRef.current.contains(event.target)) {
        return
      }

      setIsFilterMenuOpen(false)
      setIsSortMenuOpen(false)
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsFilterMenuOpen(false)
        setIsSortMenuOpen(false)
      }
    }

    window.addEventListener("mousedown", handleOutsideClick)
    window.addEventListener("keydown", handleEscape)

    return () => {
      window.removeEventListener("mousedown", handleOutsideClick)
      window.removeEventListener("keydown", handleEscape)
    }
  }, [isFilterMenuOpen, isSortMenuOpen])

  useEffect(() => {
    setPlayerSummaries(currentSummaries => {
      const nextSummaries = {}

      for (const player of favorites.players) {
        const cachedSummary = currentSummaries[player.id] || readPlayerSummaryCache(player.id)

        if (cachedSummary) {
          nextSummaries[player.id] = cachedSummary
        }
      }

      return nextSummaries
    })
  }, [favorites.players])

  function handlePlayerRemoved(playerId) {
    setFavorites(currentFavorites => {
      const nextFavorites = {
        ...currentFavorites,
        players: currentFavorites.players.filter(player => player.id !== playerId),
      }

      writeFavoritesCache(token, nextFavorites)
      writePlayerOrder(token, nextFavorites.players.map(player => player.id))
      return nextFavorites
    })
  }

  function handlePlayerMoveToTop(playerId) {
    setFavorites(currentFavorites => {
      const nextPlayers = [...currentFavorites.players]
      const playerIndex = nextPlayers.findIndex(player => player.id === playerId)

      if (playerIndex <= 0) {
        return currentFavorites
      }

      const [selectedPlayer] = nextPlayers.splice(playerIndex, 1)
      nextPlayers.unshift(selectedPlayer)

      const nextFavorites = {
        ...currentFavorites,
        players: nextPlayers,
      }

      writeFavoritesCache(token, nextFavorites)
      writePlayerOrder(token, nextPlayers.map(player => player.id))
      return nextFavorites
    })
  }

  function handlePlayerDragStart(playerId) {
    setDraggedPlayerId(playerId)
  }

  function handlePlayerDragOver(playerId) {
    if (!draggedPlayerId || draggedPlayerId === playerId) {
      return
    }

    setDragOverPlayerId(playerId)
  }

  function handlePlayerDrop(targetPlayerId) {
    if (!draggedPlayerId || draggedPlayerId === targetPlayerId) {
      setDraggedPlayerId(null)
      setDragOverPlayerId(null)
      return
    }

    setFavorites(currentFavorites => {
      const nextPlayers = [...currentFavorites.players]
      const draggedIndex = nextPlayers.findIndex(player => player.id === draggedPlayerId)
      const targetIndex = nextPlayers.findIndex(player => player.id === targetPlayerId)

      if (draggedIndex === -1 || targetIndex === -1) {
        return currentFavorites
      }

      const [draggedPlayer] = nextPlayers.splice(draggedIndex, 1)
      nextPlayers.splice(targetIndex, 0, draggedPlayer)

      const nextFavorites = {
        ...currentFavorites,
        players: nextPlayers,
      }

      writeFavoritesCache(token, nextFavorites)
      writePlayerOrder(token, nextPlayers.map(player => player.id))
      return nextFavorites
    })

    setDraggedPlayerId(null)
    setDragOverPlayerId(null)
  }

  function handlePlayerDragEnd() {
    setDraggedPlayerId(null)
    setDragOverPlayerId(null)
  }

  const tabs = [
    { id: "players", label: "Favorite Players", count: favorites.players.length },
    { id: "teams", label: "Favorite Teams", count: favorites.teams.length },
    { id: "stats", label: "Favorite Stats", count: favorites.stats.length },
  ]
  const availableDashboardTeams = useMemo(() => {
    const uniqueTeams = new Set()

    favorites.players.forEach(player => {
      const summary = playerSummaries[player.id]
      const teamAbbreviation = String(summary?.team?.abbreviation || "").toUpperCase()

      if (teamAbbreviation) {
        uniqueTeams.add(teamAbbreviation)
      }
    })

    return Array.from(uniqueTeams)
      .map(abbreviation => ({
        abbreviation,
        name: getTeamDisplayName(abbreviation),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [favorites.players, playerSummaries])
  const normalizedPlayerNameFilter = normalizeSearchFilter(playerNameFilter)
  const filteredPlayers = favorites.players.filter(player => {
    const summary = playerSummaries[player.id]
    const teamAbbreviation = String(summary?.team?.abbreviation || "").toUpperCase()
    const matchesName = !normalizedPlayerNameFilter || normalizeSearchFilter(player.name).includes(normalizedPlayerNameFilter)
    const matchesTeam = !teamFilter || teamAbbreviation === teamFilter

    return matchesName && matchesTeam
  })
  const playerOrderMap = new Map(favorites.players.map((player, index) => [player.id, index]))
  const sortedPlayers = sortCategory
    ? [...filteredPlayers].sort((leftPlayer, rightPlayer) => {
      const leftValue = getSortStatValue(playerSummaries[leftPlayer.id], sortCategory)
      const rightValue = getSortStatValue(playerSummaries[rightPlayer.id], sortCategory)
      const leftMissing = leftValue == null
      const rightMissing = rightValue == null

      if (leftMissing && rightMissing) {
        return (playerOrderMap.get(leftPlayer.id) || 0) - (playerOrderMap.get(rightPlayer.id) || 0)
      }

      if (leftMissing) {
        return 1
      }

      if (rightMissing) {
        return -1
      }

      if (leftValue === rightValue) {
        return (playerOrderMap.get(leftPlayer.id) || 0) - (playerOrderMap.get(rightPlayer.id) || 0)
      }

      return sortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue
    })
    : filteredPlayers
  const activeSortOption = PLAYER_SORT_OPTIONS.find(option => option.value === sortCategory)

  function openFilterModal() {
    setIsSortMenuOpen(false)
    setDraftPlayerNameFilter(playerNameFilter)
    setDraftTeamFilter(teamFilter)
    setIsFilterMenuOpen(true)
  }

  function closeFilterModal() {
    setDraftPlayerNameFilter(playerNameFilter)
    setDraftTeamFilter(teamFilter)
    setIsFilterMenuOpen(false)
  }

  function applyPlayerFilter() {
    setPlayerNameFilter(draftPlayerNameFilter)
    setTeamFilter(draftTeamFilter)
    setIsFilterMenuOpen(false)
  }

  function toggleFilterMenu() {
    if (isFilterMenuOpen) {
      closeFilterModal()
      return
    }

    openFilterModal()
  }

  function clearPlayerFilter() {
    setDraftPlayerNameFilter("")
    setDraftTeamFilter("")
    setPlayerNameFilter("")
    setTeamFilter("")
  }

  function handleSummaryLoaded(playerId, summary) {
    setPlayerSummaries(currentSummaries => ({
      ...currentSummaries,
      [playerId]: summary,
    }))
  }

  useEffect(() => {
    const currentTeamOptions = new Set(availableDashboardTeams.map(team => team.abbreviation))

    if (teamFilter && !currentTeamOptions.has(teamFilter)) {
      setTeamFilter("")
    }

    if (draftTeamFilter && !currentTeamOptions.has(draftTeamFilter)) {
      setDraftTeamFilter("")
    }
  }, [availableDashboardTeams, teamFilter, draftTeamFilter])

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_24%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,1))]" />
      <div className="absolute left-[-6rem] top-20 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl animate-float-slow" />
      <div className="absolute bottom-10 right-[-5rem] h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl animate-float-delayed" />

      <div className="relative mx-auto max-w-[1760px]">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] items-center justify-center">
          <div className="w-full max-w-[1760px] rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/35 backdrop-blur-2xl animate-fade-up sm:p-8 lg:p-10">
            <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl">
                  <div className="mb-3 inline-flex items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.25em] text-blue-200">
                    Dashboard
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    Netric Favorites
                  </h1>
                  <p className="mt-2 text-sm text-slate-300 sm:text-base">
                    <div>Keep up-to-date with favorite players, teams, and stats all in one place!</div> 
                    <div>Move them around and fine-tune your layout.</div>
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => navigate("/search")}
                    className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-slate-950 shadow-lg shadow-white/10 transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-100"
                  >
                    Search
                  </button>

                  <button
                    onClick={() => {
                      window.localStorage.removeItem("token")
                      navigate("/login")
                    }}
                    className="rounded-xl border border-white/15 bg-red-500/15 px-5 py-3 text-sm font-medium text-red-100 transition-all duration-300 hover:-translate-y-0.5 hover:bg-red-500/25"
                  >
                    Logout
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/20 to-cyan-400/10 p-4 shadow-lg shadow-black/15">
                  <p className="text-xs uppercase tracking-[0.24em] text-blue-100">Players</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{favorites.players.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-500/20 to-teal-400/10 p-4 shadow-lg shadow-black/15">
                  <p className="text-xs uppercase tracking-[0.24em] text-emerald-100">Teams</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{favorites.teams.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-amber-500/20 to-orange-400/10 p-4 shadow-lg shadow-black/15">
                  <p className="text-xs uppercase tracking-[0.24em] text-amber-100">Stats</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{favorites.stats.length}</p>
                </div>
              </div>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-3 rounded-2xl border border-white/10 bg-slate-950/45 p-2">
                  {tabs.map(tab => {
                    const isActive = activeTab === tab.id

                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-300 ${
                          isActive
                            ? "bg-white text-slate-950 shadow-lg shadow-white/10"
                            : "text-slate-300 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        {tab.label} <span className="text-xs opacity-70">({tab.count})</span>
                      </button>
                    )
                  })}
                </div>

                {refreshing && (
                  <p className="text-sm text-slate-400">Refreshing cached favorites…</p>
                )}
              </div>

              {error && (
                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {error}
                </div>
              )}

              <div key={activeTab} className="animate-content-in">
                {activeTab === "players" && (
                  <>
                    {loading ? (
                      <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/50 p-10 text-center shadow-lg shadow-black/20">
                        <div className="mx-auto mb-5 h-14 w-14 rounded-full border-4 border-blue-400/30 border-t-blue-400 animate-spin" />
                        <h2 className="text-2xl font-semibold text-white">Loading favorites</h2>
                        <p className="mt-2 text-sm text-slate-300">
                          Pulling your saved players and caching them locally for faster returns.
                        </p>
                      </div>
                    ) : favorites.players.length === 0 ? (
                      <div className="rounded-[1.5rem] border border-dashed border-white/15 bg-slate-900/40 p-10 text-center text-slate-300">
                        <h2 className="text-2xl font-semibold text-white">No favorite players yet</h2>
                        <p className="mt-2 text-sm">
                          Use Search to add players, then they will appear here instantly on later visits.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div ref={controlsMenuRef} className="relative flex flex-wrap items-center gap-3">
                          <button
                            onClick={toggleFilterMenu}
                            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/10 hover:text-white"
                          >
                            Filter
                          </button>

                          {isFilterMenuOpen && (
                            <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-2xl shadow-black/35 backdrop-blur-xl">
                              <label className="text-xs uppercase tracking-[0.22em] text-slate-400" htmlFor="player-name-filter">
                                Player Name
                              </label>
                              <input
                                id="player-name-filter"
                                value={draftPlayerNameFilter}
                                onChange={event => setDraftPlayerNameFilter(event.target.value)}
                                onKeyDown={event => {
                                  if (event.key === "Enter") {
                                    event.preventDefault()
                                    applyPlayerFilter()
                                  }
                                }}
                                placeholder="Search by player name"
                                className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white outline-none transition-colors duration-300 placeholder:text-slate-500 focus:border-blue-300/40"
                                autoFocus
                              />

                              <label className="mt-4 block text-xs uppercase tracking-[0.22em] text-slate-400" htmlFor="team-filter">
                                Team
                              </label>
                              <div className="mt-2 relative rounded-xl border border-white/15 bg-slate-900 transition-colors duration-300 focus-within:border-blue-300/40">
                                <select
                                  id="team-filter"
                                  value={draftTeamFilter}
                                  onChange={event => setDraftTeamFilter(event.target.value)}
                                  className="team-filter-select block w-full appearance-none rounded-xl border-0 bg-slate-900 px-3 py-2 pr-10 text-sm text-white outline-none"
                                >
                                  <option value="">All Teams</option>
                                  {availableDashboardTeams.map(team => (
                                    <option key={team.abbreviation} value={team.abbreviation}>
                                      {team.name} ({team.abbreviation})
                                    </option>
                                  ))}
                                </select>
                                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-300" aria-hidden="true">
                                  ▼
                                </span>
                              </div>

                              <p className="mt-4 text-xs text-slate-400">
                                Showing {filteredPlayers.length} of {favorites.players.length} players
                              </p>

                              <div className="mt-3 flex gap-2">
                                <button
                                  onClick={clearPlayerFilter}
                                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition-colors duration-200 hover:bg-white/10"
                                >
                                  Clear
                                </button>
                                <button
                                  onClick={applyPlayerFilter}
                                  className="ml-auto rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-950 transition-colors duration-200 hover:bg-slate-100"
                                >
                                  Apply
                                </button>
                              </div>
                            </div>
                          )}

                          <button
                            onClick={() => {
                              setIsFilterMenuOpen(false)
                              setIsSortMenuOpen(current => !current)
                            }}
                            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/10 hover:text-white"
                          >
                            Sort{activeSortOption ? `: ${activeSortOption.label} ${sortDirection === "asc" ? "↑" : "↓"}` : ""}
                          </button>

                          {isSortMenuOpen && (
                            <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-2xl shadow-black/35 backdrop-blur-xl">
                              <label className="text-xs uppercase tracking-[0.22em] text-slate-400" htmlFor="sort-category">
                                Stat Category
                              </label>
                              <select
                                id="sort-category"
                                value={sortCategory}
                                onChange={event => setSortCategory(event.target.value)}
                                className="mt-2 block w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-300/40"
                              >
                                <option value="">Default</option>
                                {PLAYER_SORT_OPTIONS.map(option => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>

                              <div className="mt-3 flex gap-2">
                                <button
                                  onClick={() => setSortDirection("desc")}
                                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${
                                    sortDirection === "desc"
                                      ? "border border-cyan-300/70 bg-cyan-300 text-slate-950 shadow-md shadow-cyan-400/25"
                                      : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                                  }`}
                                >
                                  ↓
                                </button>
                                <button
                                  onClick={() => setSortDirection("asc")}
                                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${
                                    sortDirection === "asc"
                                      ? "border border-cyan-300/70 bg-cyan-300 text-slate-950 shadow-md shadow-cyan-400/25"
                                      : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                                  }`}
                                >
                                  ↑
                                </button>
                                <button
                                  onClick={() => {
                                    setSortCategory("")
                                    setSortDirection("desc")
                                  }}
                                  className="ml-auto rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition-colors duration-200 hover:bg-white/10"
                                >
                                  Reset
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {filteredPlayers.length === 0 ? (
                          <div className="rounded-[1.5rem] border border-dashed border-white/15 bg-slate-900/40 p-10 text-center text-slate-300 animate-content-in">
                            <h2 className="text-2xl font-semibold text-white">No players match this filter</h2>
                            <p className="mt-2 text-sm">
                              Update the player name or team filter to bring cards back into the layout.
                            </p>
                          </div>
                        ) : (
                          <div className="grid gap-5 min-[1700px]:grid-cols-2">
                            {sortedPlayers.map(player => (
                              <div
                                key={player.id}
                                className="transform-gpu transition-all duration-300 ease-out animate-content-in"
                              >
                                <PlayerSummaryCard
                                  player={player}
                                  onRemoved={handlePlayerRemoved}
                                  onSummaryLoaded={handleSummaryLoaded}
                                  onMoveToTop={handlePlayerMoveToTop}
                                  onDragStart={handlePlayerDragStart}
                                  onDragOver={handlePlayerDragOver}
                                  onDrop={handlePlayerDrop}
                                  onDragEnd={handlePlayerDragEnd}
                                  isDragged={draggedPlayerId === player.id}
                                  isDragTarget={dragOverPlayerId === player.id}
                                  canMoveToTop={favorites.players.findIndex(item => item.id === player.id) >= playerGridColumns}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {activeTab === "teams" && (
                  <>
                    {favorites.teams.length === 0 ? (
                      <div className="rounded-[1.5rem] border border-dashed border-white/15 bg-slate-900/40 p-10 text-center text-slate-300">
                        No favorite teams yet.
                      </div>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {favorites.teams.map(team => (
                          <div
                            key={team.id}
                            className="rounded-[1.5rem] border border-white/10 bg-slate-900/55 p-5 shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:border-white/15"
                          >
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Team</p>
                            <p className="mt-3 text-xl font-semibold text-white">{team.name}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {activeTab === "stats" && (
                  <>
                    {favorites.stats.length === 0 ? (
                      <div className="rounded-[1.5rem] border border-dashed border-white/15 bg-slate-900/40 p-10 text-center text-slate-300">
                        No favorite stat categories yet.
                      </div>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {favorites.stats.map((stat, index) => (
                          <div
                            key={index}
                            className="rounded-[1.5rem] border border-white/10 bg-slate-900/55 p-5 shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:border-white/15"
                          >
                            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Stat</p>
                            <p className="mt-3 text-xl font-semibold text-white">{stat.type}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
