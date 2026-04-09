import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useState, useEffect, useRef } from "react"
import axios from "axios"

import ReturnHome from "../components/ReturnHome"
import { API_BASE } from "../api"
import { getGameLogKey } from "../utils/gameLog"
import { readPlayerSummaryCache, writePlayerSummaryCache } from "../utils/playerSummaryCache"

export default function PlayerInfo() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const token = typeof window !== "undefined" ? window.localStorage.getItem("token") : null

  function getFavoritesCacheKey() {
    return token ? `netric:favorites:${token}` : null
  }

  function normalizePlayerId(playerId) {
    const numericId = Number(playerId)
    return Number.isNaN(numericId) ? playerId : numericId
  }

  function isPlayerFavorited(playerId) {
    if (typeof window === "undefined") {
      return false
    }

    const cacheKey = getFavoritesCacheKey()

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
      const normalizedPlayerId = String(playerId)

      return players.some(player => String(player.id) === normalizedPlayerId)
    } catch (error) {
      console.error("Failed to read favorites cache", error)
      return false
    }
  }

  function addFavoriteToCache(player) {
    if (typeof window === "undefined") {
      return
    }

    const cacheKey = getFavoritesCacheKey()

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

      if (existingPlayers.some(existingPlayer => String(existingPlayer.id) === String(player.id))) {
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

  function removeFavoriteFromCache(playerId) {
    if (typeof window === "undefined") {
      return
    }

    const cacheKey = getFavoritesCacheKey()

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
      const normalizedPlayerId = String(playerId)

      window.localStorage.setItem(
        cacheKey,
        JSON.stringify({
          timestamp: Date.now(),
          data: {
            players: existingPlayers.filter(player => String(player.id) !== normalizedPlayerId),
            teams: Array.isArray(data.teams) ? data.teams : [],
            stats: Array.isArray(data.stats) ? data.stats : [],
          },
        })
      )
    } catch (error) {
      console.error("Failed to update favorites cache", error)
    }
  }

  const normalizedPlayerId = normalizePlayerId(id)
  const cachedSummary = readPlayerSummaryCache(id)
  const initialTab = searchParams.get("tab")
  const [tab, setTab] = useState(initialTab === "games" ? "games" : "season")
  const [selectedGameLogSeason, setSelectedGameLogSeason] = useState("")
  const [selectedGameHighSeason, setSelectedGameHighSeason] = useState("all-time")
  const [splitMode, setSplitMode] = useState("default")
  const [data, setData] = useState(cachedSummary)
  const [loading, setLoading] = useState(() => !cachedSummary)
  const [isFavorited, setIsFavorited] = useState(() => isPlayerFavorited(normalizedPlayerId))
  const gameLogScrollRef = useRef(null)

  useEffect(() => {
    const nextCachedSummary = readPlayerSummaryCache(id)

    setData(nextCachedSummary)
    if (nextCachedSummary) {
      setLoading(false)
      return undefined
    }

    setLoading(true)
    let ignore = false

    axios
      .get(`${API_BASE}/player/${id}/summary`)
      .then(res => {
        if (ignore) {
          return
        }

        setData(res.data)
        writePlayerSummaryCache(id, res.data)
      })
      .catch(err => console.error(err))
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

  useEffect(() => {
    const nextTab = searchParams.get("tab")

    if (nextTab === "games") {
      setTab("games")
      return
    }

    if (nextTab === "career") {
      setTab("career")
    }
  }, [searchParams])

  useEffect(() => {
    setIsFavorited(isPlayerFavorited(normalizedPlayerId))
  }, [normalizedPlayerId])

  useEffect(() => {
    const availableSeasons = Array.isArray(data?.available_game_log_seasons) ? data.available_game_log_seasons : []
    const requestedSeason = searchParams.get("season")
    const nextSeason = availableSeasons.includes(requestedSeason)
      ? requestedSeason
      : availableSeasons[0] || data?.season || ""

    setSelectedGameLogSeason(currentSeason =>
      availableSeasons.includes(currentSeason) || currentSeason === nextSeason ? currentSeason : nextSeason
    )
  }, [data, searchParams])

  useEffect(() => {
    const container = gameLogScrollRef.current

    if (!container) {
      return undefined
    }

    function handleWheel(event) {
      event.preventDefault()

      if (container.scrollWidth <= container.clientWidth) {
        return
      }

      container.scrollLeft += event.deltaX + event.deltaY
    }

    container.addEventListener("wheel", handleWheel, { passive: false })

    return () => {
      container.removeEventListener("wheel", handleWheel)
    }
  }, [tab, splitMode, data, selectedGameLogSeason])

  if (!data || !data.season_stats)
    return (
      <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(34,197,94,0.18),_transparent_28%)]" />

        <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
          <div className="w-full max-w-3xl rounded-[2rem] border border-white/10 bg-white/5 p-10 text-center shadow-2xl shadow-black/30 backdrop-blur-xl animate-fade-up">
            <div className="mx-auto mb-6 h-16 w-16 rounded-full border-4 border-blue-400/30 border-t-blue-400 animate-spin" />
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              {loading ? "Loading player profile" : "Refreshing player profile"}
            </h1>
            <p className="mt-3 text-sm text-slate-300 sm:text-base">
              Pulling the latest season summary and recent game data.
            </p>
          </div>
        </div>
      </div>
    )

  function formatNumber(value, decimals = 1) {
    if (value == null || Number.isNaN(Number(value))) {
      return "0.0"
    }

    return Number(value).toFixed(decimals)
  }

  function formatPerGameStat(seasonStats, stat, decimals = 1) {
    if (!seasonStats?.gp || seasonStats.gp === 0) {
      return "0.0"
    }

    if (stat == null || Number.isNaN(Number(stat))) {
      return "0.0"
    }

    return (Number(stat) / Number(seasonStats.gp)).toFixed(decimals)
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

  function formatSignedNumber(value) {
    if (value == null || Number.isNaN(Number(value))) {
      return "0"
    }

    return Number(value) > 0 ? `+${Number(value)}` : `${Number(value)}`
  }

  function formatGameHighValue(statKey, value) {
    if (statKey === "plus_minus") {
      return formatSignedNumber(value)
    }

    return formatNumber(value, 0)
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

  function getGameDisplayDate(game) {
    if (game?.game_date) {
      const parsedDate = parseGameDate(game)
      if (parsedDate) {
        return formatLongDate(parsedDate)
      }
    }

    return game?.date || "Date unavailable"
  }

  function formatLongDate(date) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date)
  }

  function getWeekStart(date) {
    const nextDate = new Date(date)
    nextDate.setDate(nextDate.getDate() - nextDate.getDay())
    return nextDate
  }

  function getWeekEnd(weekStart) {
    const nextDate = new Date(weekStart)
    nextDate.setDate(nextDate.getDate() + 6)
    return nextDate
  }

  function getGroupedGameLogRows(games, mode) {
    if (mode === "default") {
      return games.map((game, index) => ({
        type: "game",
        key: `${getGameLogKey(game, index)}-row`,
        game,
        index,
      }))
    }

    const groupedRows = []
    const groups = new Map()

    games.forEach((game, index) => {
      const parsedDate = parseGameDate(game)

      if (!parsedDate) {
        const fallbackKey = "unknown"

        if (!groups.has(fallbackKey)) {
          groups.set(fallbackKey, {
            label: "Date Unavailable",
            games: [],
          })
        }

        groups.get(fallbackKey).games.push({ game, index })
        return
      }

      if (mode === "month") {
        const key = `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, "0")}`
        const label = new Intl.DateTimeFormat("en-US", {
          month: "long",
          year: "numeric",
        }).format(parsedDate)

        if (!groups.has(key)) {
          groups.set(key, { label, games: [] })
        }

        groups.get(key).games.push({ game, index })
        return
      }

      const weekStart = getWeekStart(parsedDate)
      const weekEnd = getWeekEnd(weekStart)
      const key = weekStart.toISOString().slice(0, 10)
      const label = `${formatLongDate(weekStart)} - ${formatLongDate(weekEnd)}`

      if (!groups.has(key)) {
        groups.set(key, { label, games: [] })
      }

      groups.get(key).games.push({ game, index })
    })

    Array.from(groups.entries()).forEach(([groupKey, group]) => {
      groupedRows.push({
        type: "group",
        key: `${groupKey}-group`,
        label: group.label,
        count: group.games.length,
      })

      group.games.forEach(({ game, index }) => {
        groupedRows.push({
          type: "game",
          key: `${getGameLogKey(game, index)}-row`,
          game,
          index,
        })
      })

      const groupAverages = getGameLogAverages(group.games.map(({ game }) => game))

      if (groupAverages) {
        groupedRows.push({
          type: "groupAverage",
          key: `${groupKey}-avg`,
          averages: groupAverages,
        })
      }
    })

    return groupedRows
  }

  function getGameLogAverages(games) {
    if (!Array.isArray(games) || games.length === 0) {
      return null
    }

    const totals = games.reduce(
      (accumulator, game) => ({
        min: accumulator.min + toNumericValue(game.min),
        pts: accumulator.pts + toNumericValue(game.pts),
        reb: accumulator.reb + toNumericValue(game.reb),
        ast: accumulator.ast + toNumericValue(game.ast),
        stl: accumulator.stl + toNumericValue(game.stl),
        blk: accumulator.blk + toNumericValue(game.blk),
        tov: accumulator.tov + toNumericValue(game.tov),
        pf: accumulator.pf + toNumericValue(game.pf),
        plusMinus: accumulator.plusMinus + toNumericValue(game.plus_minus),
        fgm: accumulator.fgm + toNumericValue(game.fgm),
        fga: accumulator.fga + toNumericValue(game.fga),
        threePm: accumulator.threePm + toNumericValue(game.three_pm),
        threePa: accumulator.threePa + toNumericValue(game.three_pa),
        ftm: accumulator.ftm + toNumericValue(game.ftm),
        fta: accumulator.fta + toNumericValue(game.fta),
      }),
      {
        min: 0,
        pts: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        tov: 0,
        pf: 0,
        plusMinus: 0,
        fgm: 0,
        fga: 0,
        threePm: 0,
        threePa: 0,
        ftm: 0,
        fta: 0,
      }
    )
    const gamesPlayed = games.length

    return {
      min: formatNumber(totals.min / gamesPlayed),
      pts: formatNumber(totals.pts / gamesPlayed),
      reb: formatNumber(totals.reb / gamesPlayed),
      ast: formatNumber(totals.ast / gamesPlayed),
      stl: formatNumber(totals.stl / gamesPlayed),
      blk: formatNumber(totals.blk / gamesPlayed),
      tov: formatNumber(totals.tov / gamesPlayed),
      pf: formatNumber(totals.pf / gamesPlayed),
      plusMinus: formatSignedNumber((totals.plusMinus / gamesPlayed).toFixed(1)),
      fgm: formatNumber(totals.fgm / gamesPlayed),
      fga: formatNumber(totals.fga / gamesPlayed),
      fgPct: `${calculatePct(totals.fgm, totals.fga)}%`,
      threePm: formatNumber(totals.threePm / gamesPlayed),
      threePa: formatNumber(totals.threePa / gamesPlayed),
      fg3Pct: `${calculatePct(totals.threePm, totals.threePa)}%`,
      ftm: formatNumber(totals.ftm / gamesPlayed),
      fta: formatNumber(totals.fta / gamesPlayed),
      ftPct: `${calculatePct(totals.ftm, totals.fta)}%`,
    }
  }

  function getGameHighByStat(gameEntries, statKey) {
    if (!Array.isArray(gameEntries) || gameEntries.length === 0) {
      return null
    }

    let currentHigh = null

    gameEntries.forEach(entry => {
      const statValue = toNumericValue(entry?.game?.[statKey])

      if (!currentHigh || statValue > currentHigh.value) {
        currentHigh = {
          ...entry,
          value: statValue,
        }
      }
    })

    return currentHigh
  }

  function getGameHighsByStat(gameEntries, categories) {
    return categories.reduce((accumulator, category) => {
      accumulator[category.key] = getGameHighByStat(gameEntries, category.key)
      return accumulator
    }, {})
  }

  const tabs = [
    { id: "season", label: "Season" },
    { id: "games", label: "Game Logs" },
    { id: "career", label: "Game Highs" },
    { id: "advanced", label: "Advanced" },
  ]

  const availableGameLogSeasons = Array.isArray(data.available_game_log_seasons) ? data.available_game_log_seasons : []
  const seasonGameLogs = data.season_game_logs || {}
  const seasonStatsBySeason = data.season_stats_by_season || {}
  const availableStatSeasons = Array.isArray(data.available_stat_seasons) ? data.available_stat_seasons : []
  const activeGameLogSeason = selectedGameLogSeason || availableGameLogSeasons[0] || data.season || ""
  const activeSeason = availableStatSeasons.includes(activeGameLogSeason) ? activeGameLogSeason : data.season
  const activeSeasonStats = seasonStatsBySeason[activeSeason] || data.season_stats
  const activeSeasonGameLog = Array.isArray(seasonGameLogs[activeGameLogSeason])
    ? seasonGameLogs[activeGameLogSeason]
    : Array.isArray(data.season_game_log)
      ? data.season_game_log
      : []
  const groupedGameLogRows = getGroupedGameLogRows(activeSeasonGameLog, splitMode)
  const gameLogAverages = getGameLogAverages(activeSeasonGameLog)
  const activeLastGame = activeSeasonGameLog[0] || data.last_game || null
  const activeLastFiveGames = activeSeasonGameLog.slice(0, 5)
  const gameHighStatCategories = [
    { key: "pts", label: "PTS" },
    { key: "reb", label: "REB" },
    { key: "ast", label: "AST" },
    { key: "stl", label: "STL" },
    { key: "blk", label: "BLK" },
    { key: "fgm", label: "FGM" },
    { key: "three_pm", label: "3PM" },
    { key: "ftm", label: "FTM" },
    { key: "tov", label: "TOV" },
    { key: "min", label: "MIN" },
    { key: "plus_minus", label: "+/-" },
  ]
  const gameHighSeasonOptions = Array.from(
    new Set([
      "all-time",
      ...availableGameLogSeasons,
      ...Object.keys(seasonGameLogs || {}),
    ])
  )
  const activeGameHighSeason = gameHighSeasonOptions.includes(selectedGameHighSeason)
    ? selectedGameHighSeason
    : "all-time"
  const allTimeGameEntries = Object.entries(seasonGameLogs || {}).flatMap(([seasonId, games]) =>
    Array.isArray(games) ? games.map((game, index) => ({ seasonId: String(seasonId), game, index })) : []
  )
  const selectedGameHighEntries = activeGameHighSeason === "all-time"
    ? allTimeGameEntries
    : (seasonGameLogs[activeGameHighSeason] || []).map((game, index) => ({
      seasonId: activeGameHighSeason,
      game,
      index,
    }))
  const careerGameHighsByStat = getGameHighsByStat(allTimeGameEntries, gameHighStatCategories)
  const selectedGameHighsByStat = getGameHighsByStat(selectedGameHighEntries, gameHighStatCategories)

  const primaryStats = [
    { label: "PTS", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.pts), accent: "from-blue-500/30 to-cyan-400/10" },
    { label: "AST", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.ast), accent: "from-emerald-500/30 to-teal-400/10" },
    { label: "REB", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.reb), accent: "from-amber-500/30 to-orange-400/10" },
    { label: "TS%", value: formatPct(activeSeasonStats?.ts_pct), accent: "from-fuchsia-500/30 to-pink-400/10" },
  ]

  const seasonSections = [
    {
      title: "Per-Game Production",
      description: "A quick snapshot of nightly output across key box score stats.",
      stats: [
        { label: "PTS", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.pts) },
        { label: "AST", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.ast) },
        { label: "REB", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.reb) },
        { label: "STL", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.stl) },
        { label: "BLK", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.blk) },
        { label: "TOV", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.tov) },
        { label: "MIN", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.min_total) },
      ],
    },
    {
      title: "Shot Making",
      description: "Per-game makes with the most relevant accuracy markers.",
      stats: [
        { label: "FGM", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.fgm) },
        { label: "2PM", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.fg2pm) },
        { label: "3PM", value: formatPerGameStat(activeSeasonStats, activeSeasonStats?.three_pm) },
        { label: "FG%", value: `${formatPct(activeSeasonStats?.fg_pct)}%` },
        { label: "2FG%", value: `${calculatePct(activeSeasonStats?.fg2pm, activeSeasonStats?.fg2pa)}%` },
        { label: "3FG%", value: `${formatPct(activeSeasonStats?.fg3_pct)}%` },
        { label: "FT%", value: `${calculatePct(activeSeasonStats?.ftm, activeSeasonStats?.fta)}%` },
      ],
    },
    {
      title: "Efficiency Snapshot",
      description: "A quick look at season-level efficiency and availability.",
      stats: [
        { label: "TS%", value: `${formatPct(activeSeasonStats?.ts_pct)}%` },
        { label: "eFG%", value: `${formatPct(activeSeasonStats?.efg_pct)}%` },
        { label: "Games", value: formatNumber(activeSeasonStats?.gp, 0) },
      ],
    },
  ]

  function openGameSummaryForSeason(seasonId, game, index) {
    const targetSeason = seasonId || activeGameLogSeason
    const gameKey = getGameLogKey(game, index)
    navigate(`/player/${id}/games/${encodeURIComponent(gameKey)}?season=${encodeURIComponent(targetSeason)}`)
  }

  function openGameSummary(game, index) {
    openGameSummaryForSeason(activeGameLogSeason, game, index)
  }

  function openStatHighs(statKey) {
    navigate(`/player/${id}/game-highs/${encodeURIComponent(statKey)}`)
  }

  async function handleFavoriteToggle() {
    try {
      if (isFavorited) {
        await axios.delete(`${API_BASE}/favorites/player/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        removeFavoriteFromCache(normalizedPlayerId)
        setIsFavorited(false)
        return
      }

      await axios.post(
        `${API_BASE}/favorite/players`,
        { id: normalizedPlayerId, name: data?.name },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )

      addFavoriteToCache({ id: normalizedPlayerId, name: data?.name })
      setIsFavorited(true)
    } catch (error) {
      console.error(error)
      window.alert(isFavorited ? "Error removing favorite" : "Error favoriting player")
    }
  }

  function findGameLogIndex(targetGame) {
    if (!targetGame || activeSeasonGameLog.length === 0) {
      return -1
    }

    const directMatchIndex = activeSeasonGameLog.findIndex(game => game === targetGame)

    if (directMatchIndex >= 0) {
      return directMatchIndex
    }

    if (targetGame.game_id) {
      return activeSeasonGameLog.findIndex(game => game?.game_id === targetGame.game_id)
    }

    return activeSeasonGameLog.findIndex(game =>
      game?.game_date === targetGame.game_date &&
      game?.date === targetGame.date &&
      game?.matchup === targetGame.matchup
    )
  }

  const activeLastGameIndex = findGameLogIndex(activeLastGame)

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_26%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,1))]" />
      <div className="absolute left-[-6rem] top-20 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl animate-float-slow" />
      <div className="absolute bottom-10 right-[-5rem] h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl animate-float-delayed" />

      <div className="relative mx-auto max-w-6xl">
        <div className="mb-6 flex justify-end">
          <ReturnHome className="border border-white/10 bg-white/10 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15" />
        </div>

        <div className="mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center">
          <div className="w-full max-w-5xl rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/35 backdrop-blur-2xl animate-fade-up sm:p-8 lg:p-10">
            <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-[1.75rem] bg-gradient-to-br from-blue-400/25 via-cyan-300/15 to-emerald-300/10 blur-xl" />
                    <img
                      src={data.headshot_url}
                      alt={data.name}
                      className="relative h-32 w-32 rounded-[1.5rem] border border-white/15 object-cover shadow-xl shadow-black/25 transition-transform duration-500 hover:scale-[1.03] sm:h-36 sm:w-36"
                    />
                  </div>

                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <div className="inline-flex items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.25em] text-blue-200">
                        Player Overview
                      </div>
                      <button
                        type="button"
                        onClick={handleFavoriteToggle}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-300/50 bg-amber-400/10 text-amber-300 transition-all duration-200 hover:-translate-y-0.5 hover:bg-amber-400/20"
                        aria-label={isFavorited ? "Unfavorite player" : "Favorite player"}
                        title={isFavorited ? "Unfavorite player" : "Favorite player"}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          className={`h-5 w-5 ${isFavorited ? "fill-amber-300 stroke-amber-300" : "fill-transparent stroke-amber-300"}`}
                          strokeWidth="1.9"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m12 2.5 2.98 6.03 6.65.97-4.82 4.7 1.14 6.63L12 17.7 6.05 20.83l1.14-6.63-4.82-4.7 6.65-.97L12 2.5z"
                          />
                        </svg>
                      </button>
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                      {data.name}
                    </h1>
                    <p className="mt-2 text-sm text-slate-300 sm:text-base">
                      Season {activeSeason} • {formatNumber(activeSeasonStats?.gp, 0)} games played
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[29rem]">
                  {primaryStats.map(stat => (
                    <div
                      key={stat.label}
                      className={`group rounded-2xl border border-white/10 bg-gradient-to-br ${stat.accent} p-4 shadow-lg shadow-black/15 transition-all duration-300 hover:-translate-y-1 hover:border-white/20`}
                    >
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-300">{stat.label}</p>
                      <p className="mt-3 text-2xl font-semibold text-white transition-transform duration-300 group-hover:translate-x-1">
                        {stat.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-3 rounded-2xl border border-white/10 bg-slate-950/45 p-2 sm:justify-start">
                {tabs.map(option => {
                  const isActive = tab === option.id

                  return (
                    <button
                      key={option.id}
                      onClick={() => setTab(option.id)}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-300 ${
                        isActive
                          ? "bg-white text-slate-950 shadow-lg shadow-white/10"
                          : "text-slate-300 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>

              <div key={tab} className="animate-content-in">
                {tab === "season" && (
                  <div className="grid gap-5 lg:grid-cols-[1.3fr_0.9fr]">
                      <div className="grid gap-5">
                        {seasonSections.map(section => (
                          <div
                            key={section.title}
                            className="rounded-[1.5rem] border border-white/10 bg-slate-900/55 p-5 shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:border-white/15"
                          >
                            <div className="mb-5">
                              <h2 className="text-lg font-semibold text-white">{section.title}</h2>
                              <p className="mt-1 text-sm text-slate-400">{section.description}</p>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                              {section.stats.map(stat => (
                                <div
                                  key={stat.label}
                                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition-colors duration-300 hover:bg-white/10"
                                >
                                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{stat.label}</p>
                                  <p className="mt-2 text-xl font-semibold text-white">{stat.value}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="grid gap-5">
                        <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/55 p-5 shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:border-white/15">
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-left">
                            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Season View</p>
                            <p className="mt-2 text-sm text-slate-300">Switch seasons to compare year-over-year performance.</p>

                            <label className="mt-4 flex w-full flex-col items-start gap-2 text-sm text-slate-300">
                              <span className="text-xs uppercase tracking-[0.22em] text-slate-400">Season</span>
                              <select
                                value={activeGameLogSeason}
                                onChange={event => setSelectedGameLogSeason(event.target.value)}
                                className="min-w-36 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-left text-white outline-none transition-colors duration-300 hover:border-white/20 focus:border-blue-300/40"
                              >
                                {availableGameLogSeasons.map(season => (
                                  <option key={season} value={season}>
                                    {season}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>

                        {activeLastGame ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (activeLastGameIndex >= 0) {
                                openGameSummary(activeLastGame, activeLastGameIndex)
                              }
                            }}
                            disabled={activeLastGameIndex < 0}
                            className="rounded-[1.5rem] border border-white/10 bg-slate-900/60 p-5 text-left shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:border-white/15 disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:border-white/10"
                          >
                            <p className="text-xs uppercase tracking-[0.3em] text-emerald-200">Last Game</p>
                            <h2 className="mt-3 text-xl font-semibold text-white">{activeLastGame.matchup}</h2>
                            <p className="mt-1 text-sm text-slate-400">{activeLastGame.date}</p>

                            <div className="mt-5 grid grid-cols-3 gap-3">
                              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center">
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">PTS</p>
                                <p className="mt-2 text-xl font-semibold text-white">{formatNumber(activeLastGame.pts, 0)}</p>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center">
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">AST</p>
                                <p className="mt-2 text-xl font-semibold text-white">{formatNumber(activeLastGame.ast, 0)}</p>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center">
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">REB</p>
                                <p className="mt-2 text-xl font-semibold text-white">{formatNumber(activeLastGame.reb, 0)}</p>
                              </div>
                            </div>
                          </button>
                        ) : (
                          <div className="rounded-[1.5rem] border border-dashed border-white/12 bg-slate-900/40 p-5 text-sm text-slate-400">
                            Recent game data is not available for this player yet.
                          </div>
                        )}

                        {activeLastFiveGames.length > 0 && (
                          <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/60 p-5 shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:border-white/15">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Last 5 Games</p>
                                <p className="mt-2 text-sm text-slate-300">
                                  Click into the game log tab for the full season table.
                                </p>
                              </div>

                              <button
                                onClick={() => setTab("games")}
                                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/10"
                              >
                                Open Game Log
                              </button>
                            </div>

                            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                              {activeLastFiveGames.map((game, index) => (
                                <button
                                  key={`${game.game_id || game.game_date || game.matchup}-preview`}
                                  type="button"
                                  onClick={() => openGameSummary(game, index)}
                                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/6 to-white/0 px-4 py-4 text-left transition-all duration-300 hover:-translate-y-1 hover:border-blue-300/25 hover:bg-white/10"
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{game.date}</p>
                                      <h3 className="mt-2 text-sm font-semibold text-white">{game.matchup}</h3>
                                      <p className="mt-1 text-xs text-slate-300">{game.result || "Pending"} • {game.min || "-"} MIN</p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-right text-sm">
                                      <div>
                                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">TS%</p>
                                        <p className="mt-1 font-semibold text-white">{formatPct(game.ts_pct)}</p>
                                      </div>
                                      <div>
                                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">EF%</p>
                                        <p className="mt-1 font-semibold text-white">{formatPct(game.efg_pct)}</p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="mt-4 grid grid-cols-3 gap-3">
                                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center">
                                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">PTS</p>
                                      <p className="mt-1 font-medium text-white">{formatNumber(game.pts, 0)}</p>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center">
                                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">REB</p>
                                      <p className="mt-1 font-medium text-white">{formatNumber(game.reb, 0)}</p>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-center">
                                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">AST</p>
                                      <p className="mt-1 font-medium text-white">{formatNumber(game.ast, 0)}</p>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                  </div>
                )}

                {tab === "games" && (
                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/55 p-5 shadow-lg shadow-black/20">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Season Game Logs</p>
                        <h2 className="mt-2 text-2xl font-semibold text-white">
                          {activeSeasonGameLog.length} Games Played
                        </h2>
                        <p className="mt-2 text-sm text-slate-300">
                          Full season game log with the expanded box score breakdown for each game.
                        </p>
                      </div>

                      <div className="relative flex flex-col gap-3 sm:right-[10px] sm:flex-row sm:items-end sm:gap-4">
                        <label className="flex flex-col gap-2 text-sm text-slate-300 sm:items-start">
                          <span className="pl-2 text-xs uppercase tracking-[0.22em] text-slate-400">Season</span>
                          <select
                            value={activeGameLogSeason}
                            onChange={event => setSelectedGameLogSeason(event.target.value)}
                            className="w-fit rounded-xl border border-white/10 bg-slate-950/70 pl-2 pr-1 py-2 text-white outline-none transition-colors duration-300 hover:border-white/20 focus:border-blue-300/40"
                          >
                            {availableGameLogSeasons.map(season => (
                              <option key={season} value={season}>
                                {season}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="flex flex-col gap-2 text-sm text-slate-300 sm:items-start">
                          <span className="pl-2 text-xs uppercase tracking-[0.22em] text-slate-400">View</span>
                          <select
                            value={splitMode}
                            onChange={event => setSplitMode(event.target.value)}
                            className="w-fit rounded-xl border border-white/10 bg-slate-950/70 pl-2 pr-1 py-2 text-white outline-none transition-colors duration-300 hover:border-white/20 focus:border-blue-300/40"
                          >
                            <option value="default">Default</option>
                            <option value="week">Week</option>
                            <option value="month">Month</option>
                          </select>
                        </label>
                      </div>
                    </div>

                    {activeSeasonGameLog.length > 0 ? (
                      <div className="mt-5 w-[calc(100%-0.5rem)] overflow-hidden rounded-[1.25rem] border border-white/10 bg-slate-950/45 pb-3">
                        <div
                          ref={gameLogScrollRef}
                          className="game-log-scroll overflow-x-auto overflow-y-hidden"
                          style={{ overscrollBehavior: "contain" }}
                        >
                          <table className="game-log-table min-w-full w-max text-left text-sm text-slate-200">
                            <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-400">
                              <tr>
                                <th className="px-4 py-3 font-medium">Date</th>
                                <th className="px-4 py-3 font-medium">Matchup</th>
                                <th className="px-4 py-3 font-medium">Result</th>
                                <th className="px-4 py-3 font-medium">MIN</th>
                                <th className="px-4 py-3 font-medium">PTS</th>
                                <th className="px-4 py-3 font-medium">REB</th>
                                <th className="px-4 py-3 font-medium">AST</th>
                                <th className="px-4 py-3 font-medium">STL</th>
                                <th className="px-4 py-3 font-medium">BLK</th>
                                <th className="px-4 py-3 font-medium">TOV</th>
                                <th className="px-4 py-3 font-medium">PF</th>
                                <th className="px-4 py-3 font-medium">FG</th>
                                <th className="px-4 py-3 font-medium">FGA</th>
                                <th className="px-4 py-3 font-medium">FG%</th>
                                <th className="px-4 py-3 font-medium">3P</th>
                                <th className="px-4 py-3 font-medium">3PA</th>
                                <th className="px-4 py-3 font-medium">3P%</th>
                                <th className="px-4 py-3 font-medium">FT</th>
                                <th className="px-4 py-3 font-medium">FTA</th>
                                <th className="px-4 py-3 font-medium">FT%</th>
                                <th className="pl-4 pr-7 py-3 font-medium">+/-</th>
                              </tr>
                            </thead>
                            <tbody>
                              {groupedGameLogRows.map(row => {
                                if (row.type === "group") {
                                  return (
                                    <tr key={row.key} className="border-t border-white/10 bg-white/[0.03]">
                                      <td colSpan={21} className="px-4 py-3">
                                        <div className="flex items-center justify-between gap-4">
                                          <span className="text-xs font-medium uppercase tracking-[0.22em] text-blue-200">
                                            {row.label}
                                          </span>
                                          <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                                            {row.count} {row.count === 1 ? "game" : "games"}
                                          </span>
                                        </div>
                                      </td>
                                    </tr>
                                  )
                                }

                                if (row.type === "groupAverage") {
                                  return (
                                    <tr key={row.key} className="border-t border-white/10 bg-white/[0.04] text-sm text-slate-100">
                                      <td className="px-4 py-3 font-semibold uppercase tracking-[0.16em] text-blue-200">Avg</td>
                                      <td className="px-4 py-3" />
                                      <td className="px-4 py-3" />
                                      <td className="px-4 py-3 font-medium">{row.averages.min}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.pts}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.reb}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.ast}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.stl}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.blk}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.tov}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.pf}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.fgm}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.fga}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.fgPct}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.threePm}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.threePa}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.fg3Pct}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.ftm}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.fta}</td>
                                      <td className="px-4 py-3 font-medium">{row.averages.ftPct}</td>
                                      <td className="pl-4 pr-7 py-3 font-medium">{row.averages.plusMinus}</td>
                                    </tr>
                                  )
                                }

                                const { game, index } = row

                                return (
                                  <tr
                                    key={`${row.key}-page-log`}
                                    onClick={() => openGameSummary(game, index)}
                                    onKeyDown={event => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault()
                                        openGameSummary(game, index)
                                      }
                                    }}
                                    className="cursor-pointer border-t border-white/6 outline-none transition-colors duration-300 hover:bg-white/5 focus:bg-white/5"
                                    tabIndex={0}
                                    role="link"
                                  >
                                    <td className="px-4 py-3 text-slate-300">{game.date}</td>
                                    <td className="px-4 py-3 font-medium text-white">{game.matchup}</td>
                                    <td className="px-4 py-3 text-slate-300">{game.result || "-"}</td>
                                    <td className="px-4 py-3 text-slate-300">{game.min || "-"}</td>
                                    <td className="px-4 py-3">{formatNumber(game.pts, 0)}</td>
                                    <td className="px-4 py-3">{formatNumber(game.reb, 0)}</td>
                                    <td className="px-4 py-3">{formatNumber(game.ast, 0)}</td>
                                    <td className="px-4 py-3">{formatNumber(game.stl, 0)}</td>
                                    <td className="px-4 py-3">{formatNumber(game.blk, 0)}</td>
                                    <td className="px-4 py-3">{formatNumber(game.tov, 0)}</td>
                                    <td className="px-4 py-3">{formatNumber(game.pf, 0)}</td>
                                    <td className="px-4 py-3">{formatNumber(game.fgm, 0)}</td>
                                    <td className="px-4 py-3">{formatNumber(game.fga, 0)}</td>
                                    <td className="px-4 py-3">{formatPct(game.fg_pct)}%</td>
                                    <td className="px-4 py-3">{formatNumber(game.three_pm, 0)}</td>
                                    <td className="px-4 py-3">{formatNumber(game.three_pa, 0)}</td>
                                    <td className="px-4 py-3">{formatPct(game.fg3_pct)}%</td>
                                    <td className="px-4 py-3">{formatNumber(game.ftm, 0)}</td>
                                    <td className="px-4 py-3">{formatNumber(game.fta, 0)}</td>
                                    <td className="px-4 py-3">{formatPct(game.ft_pct)}%</td>
                                    <td className="pl-4 pr-7 py-3">{formatSignedNumber(game.plus_minus)}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                            {gameLogAverages && (
                              <tfoot className="border-t border-white/12 bg-white/[0.04]">
                                <tr className="text-sm text-white">
                                  <td className="px-4 py-3 font-semibold uppercase tracking-[0.18em] text-blue-200">Avg</td>
                                  <td className="px-4 py-3" />
                                  <td className="px-4 py-3" />
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.min}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.pts}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.reb}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.ast}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.stl}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.blk}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.tov}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.pf}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.fgm}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.fga}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.fgPct}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.threePm}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.threePa}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.fg3Pct}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.ftm}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.fta}</td>
                                  <td className="px-4 py-3 font-medium">{gameLogAverages.ftPct}</td>
                                  <td className="pl-4 pr-7 py-3 font-medium">{gameLogAverages.plusMinus}</td>
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-5 rounded-[1.25rem] border border-dashed border-white/12 bg-slate-900/35 p-6 text-sm text-slate-400">
                        Season game log data is not available for this player yet.
                      </div>
                    )}
                  </div>
                )}

                {tab === "career" && (
                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/55 p-5 shadow-lg shadow-black/20">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Game Highs</p>
                        <h2 className="mt-2 text-2xl font-semibold text-white">
                          {activeGameHighSeason === "all-time" ? "All-Time Single-Game Highs" : `Season ${activeGameHighSeason} Game Highs`}
                        </h2>
                        <p className="mt-2 text-sm text-slate-300">
                          Each category shows a single-game peak. Season highs are highlighted when they match the all-time career high.
                        </p>
                      </div>

                      <label className="flex w-fit flex-col gap-2 text-sm text-slate-300">
                        <span className="pl-2 text-xs uppercase tracking-[0.22em] text-slate-400">Scope</span>
                        <select
                          value={activeGameHighSeason}
                          onChange={event => setSelectedGameHighSeason(event.target.value)}
                          className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-white outline-none transition-colors duration-300 hover:border-white/20 focus:border-blue-300/40"
                        >
                          {gameHighSeasonOptions.map(season => (
                            <option key={season} value={season}>
                              {season === "all-time" ? "All-Time" : season}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {selectedGameHighEntries.length > 0 ? (
                      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {gameHighStatCategories.map(category => {
                          const currentHigh = selectedGameHighsByStat[category.key]
                          const allTimeHigh = careerGameHighsByStat[category.key]
                          const isCareerHighMatch = Boolean(
                            currentHigh &&
                            allTimeHigh &&
                            currentHigh.value === allTimeHigh.value
                          )

                          if (!currentHigh) {
                            return (
                              <div
                                key={category.key}
                                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left"
                              >
                                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{category.label}</p>
                                <p className="mt-3 text-3xl font-semibold text-white">-</p>
                                <p className="mt-3 text-xs text-slate-400">No game data available.</p>
                              </div>
                            )
                          }

                          return (
                            <div
                              key={category.key}
                              role="button"
                              tabIndex={0}
                              onClick={() => openStatHighs(category.key)}
                              onKeyDown={event => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault()
                                  openStatHighs(category.key)
                                }
                              }}
                              className={`rounded-2xl border px-4 py-4 text-left transition-all duration-300 hover:-translate-y-0.5 cursor-pointer ${
                                isCareerHighMatch
                                  ? "border-blue-300/35 bg-gradient-to-br from-blue-500/20 to-cyan-400/10 shadow-lg shadow-blue-900/20"
                                  : "border-white/10 bg-white/5 hover:border-white/20"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-xs uppercase tracking-[0.22em] text-slate-300">{category.label}</p>
                                {isCareerHighMatch && (
                                  <span className="rounded-full border border-blue-200/30 bg-blue-300/15 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-blue-100">
                                    Career High
                                  </span>
                                )}
                              </div>
                              <p className="mt-3 text-3xl font-semibold text-white">
                                {formatGameHighValue(category.key, currentHigh.value)}
                              </p>
                              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                                {currentHigh.seasonId}
                              </p>
                              <div className="mt-1 flex items-end justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-slate-100">
                                    {currentHigh.game?.matchup || "Matchup unavailable"}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-400">
                                    {getGameDisplayDate(currentHigh.game)} • {currentHigh.game?.result || "Result unavailable"}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={event => {
                                    event.stopPropagation()
                                    openGameSummaryForSeason(currentHigh.seasonId, currentHigh.game, currentHigh.index)
                                  }}
                                  className="rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-300 hover:bg-white/15"
                                >
                                  View Game
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="mt-5 rounded-[1.25rem] border border-dashed border-white/12 bg-slate-900/35 p-6 text-sm text-slate-400">
                        Game log data is not available yet, so game highs cannot be calculated.
                      </div>
                    )}
                  </div>
                )}

                {tab === "advanced" && (
                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/55 p-8 text-center shadow-lg shadow-black/20">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Advanced</p>
                    <h2 className="mt-3 text-2xl font-semibold text-white">Advanced metrics placeholder</h2>
                    <p className="mt-3 text-sm text-slate-300">
                      This section can hold usage, rate stats, and comparison visuals once the API returns them.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
