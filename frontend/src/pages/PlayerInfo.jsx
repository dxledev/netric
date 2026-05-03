import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useState, useEffect, useRef } from "react"
import axios from "axios"

import ReturnHome from "../components/ReturnHome"
import { API_BASE } from "../api"
import { getGameLogKey } from "../utils/gameLog"
import { readPlayerSummaryCache, writePlayerSummaryCache } from "../utils/playerSummaryCache"

function decodeBase64Url(value) {
  const normalizedValue = value.replace(/-/g, "+").replace(/_/g, "/")
  const paddedValue = normalizedValue.padEnd(normalizedValue.length + ((4 - normalizedValue.length % 4) % 4), "=")

  return window.atob(paddedValue)
}

function decodeTokenPayload(token) {
  if (!token || typeof window === "undefined") {
    return null
  }

  try {
    const payloadSegment = token.split(".")[1]

    if (!payloadSegment) {
      return null
    }

    return JSON.parse(decodeBase64Url(payloadSegment))
  } catch (error) {
    console.error("Failed to decode profile token", error)
    return null
  }
}

function getDisplayName(email) {
  const [name = "Netric User"] = String(email || "Netric User").split("@")

  return name
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ") || "Netric User"
}

function getInitials(value) {
  const normalizedValue = String(value || "User")
  const [name = normalizedValue] = normalizedValue.split("@")
  const parts = name.split(/[._\s-]+/).filter(Boolean)
  const initials = parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join("")

  return initials || "U"
}

function getProfileStorageKey(email, token) {
  if (email && email !== "Unknown email") {
    return `netric:profile:${email}`
  }

  return token ? `netric:profile:${token}` : null
}

function readStoredProfile(email, token) {
  if (typeof window === "undefined") {
    return null
  }

  const cacheKey = getProfileStorageKey(email, token)

  if (!cacheKey) {
    return null
  }

  try {
    const rawProfile = window.localStorage.getItem(cacheKey)

    return rawProfile ? JSON.parse(rawProfile) : null
  } catch (error) {
    console.error("Failed to read stored profile", error)
    return null
  }
}

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
  const [gameLogDateSortDirection, setGameLogDateSortDirection] = useState("asc")
  const [isPostSeason, setIsPostSeason] = useState(() => searchParams.get("postseason") === "1")
  const [data, setData] = useState(cachedSummary)
  const [loading, setLoading] = useState(() => !cachedSummary)
  const [isFavorited, setIsFavorited] = useState(() => isPlayerFavorited(normalizedPlayerId))
  const [loadError, setLoadError] = useState("")
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [commentsError, setCommentsError] = useState("")
  const [commentDraft, setCommentDraft] = useState("")
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState(null)
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now())
  const gameLogScrollRef = useRef(null)

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

        setLoadError("")
        setData(res.data)
        writePlayerSummaryCache(id, res.data)
      })
      .catch(err => {
        console.error(err)

        if (ignore) {
          return
        }

        setLoadError("Unable to load this player summary right now. Please try again shortly.")
      })
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
    const nextIsPostSeason = searchParams.get("postseason") === "1"

    setIsPostSeason(nextIsPostSeason)

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
    let ignore = false

    setCommentsLoading(true)
    setCommentsError("")

    axios
      .get(`${API_BASE}/player/${id}/comments`, token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : undefined
      )
      .then(res => {
        if (ignore) {
          return
        }

        setComments(Array.isArray(res.data?.comments) ? res.data.comments : [])
      })
      .catch(err => {
        console.error(err)

        if (ignore) {
          return
        }

        setComments([])
        setCommentsError("Unable to load comments right now.")
      })
      .finally(() => {
        if (ignore) {
          return
        }

        setCommentsLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [id, token])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRelativeTimeNow(Date.now())
    }, 60000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const playoffSeasons = Array.isArray(data?.available_playoff_game_log_seasons) ? data.available_playoff_game_log_seasons : []
    const playInSeasons = Array.isArray(data?.available_playin_game_log_seasons) ? data.available_playin_game_log_seasons : []
    const regularSeasons = Array.isArray(data?.available_game_log_seasons) ? data.available_game_log_seasons : []
    const availableSeasons = isPostSeason ? Array.from(new Set([...playoffSeasons, ...playInSeasons])) : regularSeasons
    const fallbackSeason = isPostSeason ? data?.playoff_season || data?.playin_season || "" : data?.season || ""
    const requestedSeason = searchParams.get("season")
    const nextSeason = availableSeasons.includes(requestedSeason)
      ? requestedSeason
      : availableSeasons[0] || fallbackSeason

    setSelectedGameLogSeason(currentSeason =>
      availableSeasons.includes(currentSeason) ? currentSeason : nextSeason
    )
  }, [data, isPostSeason, searchParams])

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
            {!loading && loadError && (
              <p className="mt-4 rounded-xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {loadError}
              </p>
            )}
          </div>
        </div>
      </div>
    )

  const currentUserPayload = decodeTokenPayload(token)
  const currentUserEmail = currentUserPayload?.sub || "Unknown email"
  const currentStoredProfile = readStoredProfile(currentUserEmail, token) || {}
  const currentUsername = currentStoredProfile.username || getDisplayName(currentUserEmail)
  const currentProfileImage = currentStoredProfile.image || null

  async function handleCommentSubmit(event) {
    event.preventDefault()

    const trimmedComment = commentDraft.trim()

    if (!trimmedComment) {
      return
    }

    if (!token) {
      navigate("/login")
      return
    }

    setCommentSubmitting(true)
    setCommentsError("")

    try {
      const res = await axios.post(
        `${API_BASE}/player/${id}/comments`,
        {
          text: trimmedComment,
          username: currentUsername,
          profile_image: currentProfileImage,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      const createdComment = res.data?.comment

      if (createdComment) {
        setComments(currentComments => [createdComment, ...currentComments])
      }

      setCommentDraft("")
    } catch (error) {
      console.error(error)
      const detail = error.response?.data?.detail
      setCommentsError(detail || "Unable to post that comment right now.")
    } finally {
      setCommentSubmitting(false)
    }
  }

  async function handleDeleteComment(commentId) {
    if (!token || !commentId) {
      return
    }

    setDeletingCommentId(commentId)
    setCommentsError("")

    try {
      await axios.delete(`${API_BASE}/player/${id}/comments/${commentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setComments(currentComments => currentComments.filter(comment => comment.id !== commentId))
    } catch (error) {
      console.error(error)
      const detail = error.response?.data?.detail
      setCommentsError(detail || "Unable to delete that comment right now.")
    } finally {
      setDeletingCommentId(null)
    }
  }

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
    const rawDate = game?.game_date || game?.date

    if (!rawDate) {
      return null
    }

    const dateText = String(rawDate)
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateText)
      ? new Date(`${dateText}T00:00:00`)
      : new Date(dateText)

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

  function formatRelativeTime(value, now = Date.now()) {
    const parsedDate = new Date(value)

    if (!value || Number.isNaN(parsedDate.getTime())) {
      return "Just now"
    }

    const diffSeconds = Math.max(0, Math.floor((now - parsedDate.getTime()) / 1000))
    const units = [
      { label: "year", seconds: 31536000 },
      { label: "month", seconds: 2592000 },
      { label: "week", seconds: 604800 },
      { label: "day", seconds: 86400 },
      { label: "hour", seconds: 3600 },
      { label: "minute", seconds: 60 },
    ]
    const matchedUnit = units.find(unit => diffSeconds >= unit.seconds)

    if (!matchedUnit) {
      return "Just now"
    }

    const count = Math.floor(diffSeconds / matchedUnit.seconds)

    return `${count} ${matchedUnit.label}${count === 1 ? "" : "s"} ago`
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

  function normalizeGameLogEntries(games) {
    if (!Array.isArray(games)) {
      return []
    }

    return games.map((entry, fallbackIndex) => {
      if (
        entry &&
        Object.prototype.hasOwnProperty.call(entry, "game") &&
        Object.prototype.hasOwnProperty.call(entry, "index")
      ) {
        return entry
      }

      return {
        game: entry,
        index: fallbackIndex,
      }
    })
  }

  function getGroupedGameLogRows(games, mode) {
    const gameEntries = normalizeGameLogEntries(games)

    if (mode === "default") {
      return gameEntries.map(({ game, index }) => ({
        type: "game",
        key: `${getGameLogKey(game, index)}-row`,
        game,
        index,
      }))
    }

    const groupedRows = []
    const groups = new Map()

    gameEntries.forEach(({ game, index }) => {
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

  const nbaTeamAliases = [
    { abbr: "ATL", conference: "Eastern", aliases: ["ATL", "Atlanta Hawks"] },
    { abbr: "BKN", conference: "Eastern", aliases: ["BKN", "BRK", "Brooklyn Nets", "New Jersey Nets"] },
    { abbr: "BOS", conference: "Eastern", aliases: ["BOS", "Boston Celtics"] },
    { abbr: "CHA", conference: "Eastern", aliases: ["CHA", "CHH", "Charlotte Hornets", "Charlotte Bobcats"] },
    { abbr: "CHI", conference: "Eastern", aliases: ["CHI", "Chicago Bulls"] },
    { abbr: "CLE", conference: "Eastern", aliases: ["CLE", "Cleveland Cavaliers"] },
    { abbr: "DAL", conference: "Western", aliases: ["DAL", "Dallas Mavericks"] },
    { abbr: "DEN", conference: "Western", aliases: ["DEN", "Denver Nuggets"] },
    { abbr: "DET", conference: "Eastern", aliases: ["DET", "Detroit Pistons"] },
    { abbr: "GSW", conference: "Western", aliases: ["GSW", "Golden State Warriors"] },
    { abbr: "HOU", conference: "Western", aliases: ["HOU", "Houston Rockets"] },
    { abbr: "IND", conference: "Eastern", aliases: ["IND", "Indiana Pacers"] },
    { abbr: "LAC", conference: "Western", aliases: ["LAC", "LA Clippers", "Los Angeles Clippers"] },
    { abbr: "LAL", conference: "Western", aliases: ["LAL", "Los Angeles Lakers"] },
    { abbr: "MEM", conference: "Western", aliases: ["MEM", "VAN", "Memphis Grizzlies", "Vancouver Grizzlies"] },
    { abbr: "MIA", conference: "Eastern", aliases: ["MIA", "Miami Heat"] },
    { abbr: "MIL", conference: "Eastern", aliases: ["MIL", "Milwaukee Bucks"] },
    { abbr: "MIN", conference: "Western", aliases: ["MIN", "Minnesota Timberwolves"] },
    { abbr: "NOP", conference: "Western", aliases: ["NOP", "NOH", "NOK", "New Orleans Pelicans", "New Orleans Hornets"] },
    { abbr: "NYK", conference: "Eastern", aliases: ["NYK", "New York Knicks"] },
    { abbr: "OKC", conference: "Western", aliases: ["OKC", "Oklahoma City Thunder", "Seattle SuperSonics", "Seattle Supersonics"] },
    { abbr: "ORL", conference: "Eastern", aliases: ["ORL", "Orlando Magic"] },
    { abbr: "PHI", conference: "Eastern", aliases: ["PHI", "Philadelphia 76ers", "Philadelphia Sixers"] },
    { abbr: "PHX", conference: "Western", aliases: ["PHX", "Phoenix Suns"] },
    { abbr: "POR", conference: "Western", aliases: ["POR", "Portland Trail Blazers"] },
    { abbr: "SAC", conference: "Western", aliases: ["SAC", "Kansas City Kings", "Sacramento Kings"] },
    { abbr: "SAS", conference: "Western", aliases: ["SAS", "SA", "San Antonio Spurs"] },
    { abbr: "TOR", conference: "Eastern", aliases: ["TOR", "Toronto Raptors"] },
    { abbr: "UTA", conference: "Western", aliases: ["UTA", "Utah Jazz"] },
    { abbr: "WAS", conference: "Eastern", aliases: ["WAS", "WSB", "Washington Wizards", "Washington Bullets"] },
  ]
  const nbaTeamNamesByAbbreviation = {
    ATL: "Atlanta Hawks",
    BKN: "Brooklyn Nets",
    BOS: "Boston Celtics",
    CHA: "Charlotte Hornets",
    CHI: "Chicago Bulls",
    CLE: "Cleveland Cavaliers",
    DAL: "Dallas Mavericks",
    DEN: "Denver Nuggets",
    DET: "Detroit Pistons",
    GSW: "Golden State Warriors",
    HOU: "Houston Rockets",
    IND: "Indiana Pacers",
    LAC: "Los Angeles Clippers",
    LAL: "Los Angeles Lakers",
    MEM: "Memphis Grizzlies",
    MIA: "Miami Heat",
    MIL: "Milwaukee Bucks",
    MIN: "Minnesota Timberwolves",
    NOP: "New Orleans Pelicans",
    NYK: "New York Knicks",
    OKC: "Oklahoma City Thunder",
    ORL: "Orlando Magic",
    PHI: "Philadelphia 76ers",
    PHX: "Phoenix Suns",
    POR: "Portland Trail Blazers",
    SAC: "Sacramento Kings",
    SAS: "San Antonio Spurs",
    TOR: "Toronto Raptors",
    UTA: "Utah Jazz",
    WAS: "Washington Wizards",
  }
  const nbaTeamLogoIdsByAbbreviation = {
    ATL: "1610612737",
    BKN: "1610612751",
    BOS: "1610612738",
    CHA: "1610612766",
    CHI: "1610612741",
    CLE: "1610612739",
    DAL: "1610612742",
    DEN: "1610612743",
    DET: "1610612765",
    GSW: "1610612744",
    HOU: "1610612745",
    IND: "1610612754",
    LAC: "1610612746",
    LAL: "1610612747",
    MEM: "1610612763",
    MIA: "1610612748",
    MIL: "1610612749",
    MIN: "1610612750",
    NOP: "1610612740",
    NYK: "1610612752",
    OKC: "1610612760",
    ORL: "1610612753",
    PHI: "1610612755",
    PHX: "1610612756",
    POR: "1610612757",
    SAC: "1610612758",
    SAS: "1610612759",
    TOR: "1610612761",
    UTA: "1610612762",
    WAS: "1610612764",
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  function getTeamFromMatchupText(text) {
    const normalizedText = String(text || "")

    if (!normalizedText) {
      return null
    }

    return nbaTeamAliases.find(team =>
      team.aliases.some(alias => {
        const escapedAlias = escapeRegExp(alias)
        const aliasPattern = /^[A-Z]{2,3}$/.test(alias)
          ? `\\b${escapedAlias}\\b`
          : `(?:^|[^A-Za-z0-9])${escapedAlias}(?:$|[^A-Za-z0-9])`

        return new RegExp(aliasPattern, "i").test(normalizedText)
      })
    ) || null
  }

  function getPlayoffMatchupTeams(game) {
    const matchup = String(game?.matchup || "")
    const matchupParts = matchup.split(/\s+(?:vs\.?|@)\s+/i)

    if (matchupParts.length >= 2) {
      return {
        playerTeam: getTeamFromMatchupText(matchupParts[0]),
        opponentTeam: getTeamFromMatchupText(matchupParts.slice(1).join(" ")),
      }
    }

    return {
      playerTeam: null,
      opponentTeam: getTeamFromMatchupText(matchup),
    }
  }

  function getExpandedTeamName(team) {
    const teamName = String(team?.name || "").trim()

    if (teamName) {
      return teamName
    }

    const teamAbbreviation = String(team?.abbreviation || team || "").trim().toUpperCase()
    const matchedTeam = nbaTeamAliases.find(aliasTeam => aliasTeam.abbr === teamAbbreviation)
      || getTeamFromMatchupText(teamAbbreviation)

    return nbaTeamNamesByAbbreviation[matchedTeam?.abbr || teamAbbreviation] || teamAbbreviation
  }

  function getTeamAbbreviation(team) {
    const teamAbbreviation = String(team?.abbreviation || "").trim().toUpperCase()

    if (nbaTeamNamesByAbbreviation[teamAbbreviation]) {
      return teamAbbreviation
    }

    const teamName = String(team?.name || team || "").trim()
    const matchedTeam = nbaTeamAliases.find(aliasTeam =>
      aliasTeam.aliases.some(alias => alias.toLowerCase() === teamName.toLowerCase())
    ) || getTeamFromMatchupText(teamName)

    return matchedTeam?.abbr || ""
  }

  function getTeamLogoUrl(team) {
    const teamId = nbaTeamLogoIdsByAbbreviation[getTeamAbbreviation(team)]

    return teamId ? `https://cdn.nba.com/logos/nba/${teamId}/primary/L/logo.svg` : ""
  }

  function getPlayoffOpponentKey(game) {
    return getPlayoffMatchupTeams(game).opponentTeam?.abbr || ""
  }

  function getPlayoffRoundIndex(game) {
    const rawRound = game?.round || game?.round_name || game?.playoff_round || game?.series_round

    if (rawRound == null || rawRound === "") {
      return null
    }

    const normalizedRound = String(rawRound).toLowerCase()
    const numericRound = Number.parseInt(normalizedRound, 10)

    if (!Number.isNaN(numericRound)) {
      return Math.max(0, numericRound - 1)
    }

    if (normalizedRound.includes("play-in") || normalizedRound.includes("play in")) {
      return -1
    }

    if (normalizedRound.includes("final") && !normalizedRound.includes("conference")) {
      return 3
    }

    if (normalizedRound.includes("conference final")) {
      return 2
    }

    if (normalizedRound.includes("semi")) {
      return 1
    }

    if (normalizedRound.includes("first") || normalizedRound.includes("round one") || normalizedRound.includes("round 1")) {
      return 0
    }

    return null
  }

  function getPlayoffRoundLabel(roundIndex, conference) {
    const conferencePrefix = conference ? `${conference} Conference ` : "Conference "

    if (roundIndex === 0) {
      return `${conferencePrefix}Round One`
    }

    if (roundIndex === 1) {
      return `${conferencePrefix}Semi-Finals`
    }

    if (roundIndex === 2) {
      return `${conferencePrefix}Finals`
    }

    if (roundIndex === 3) {
      return "NBA Finals"
    }

    return `Playoff Round ${roundIndex + 1}`
  }

  function getPlayInRoundLabel(conference) {
    return conference ? `${conference} Conference Play-In` : "Conference Play-In"
  }

  function getPlayoffGameTimestamp(game) {
    const parsedDate = parseGameDate(game)
    return parsedDate ? parsedDate.getTime() : null
  }

  function compareGameLogEntriesByDate(firstEntry, secondEntry, direction = "asc") {
    const firstTimestamp = getPlayoffGameTimestamp(firstEntry.game)
    const secondTimestamp = getPlayoffGameTimestamp(secondEntry.game)
    const directionMultiplier = direction === "desc" ? -1 : 1

    if (firstTimestamp != null && secondTimestamp != null && firstTimestamp !== secondTimestamp) {
      return (firstTimestamp - secondTimestamp) * directionMultiplier
    }

    if (firstTimestamp != null && secondTimestamp == null) {
      return -1
    }

    if (firstTimestamp == null && secondTimestamp != null) {
      return 1
    }

    return (firstEntry.index - secondEntry.index) * directionMultiplier
  }

  function getSortedGameLogEntries(games, direction = "asc") {
    return normalizeGameLogEntries(games).sort((firstEntry, secondEntry) =>
      compareGameLogEntriesByDate(firstEntry, secondEntry, direction)
    )
  }

  function comparePlayoffEntriesChronologically(firstEntry, secondEntry) {
    const firstTimestamp = getPlayoffGameTimestamp(firstEntry.game)
    const secondTimestamp = getPlayoffGameTimestamp(secondEntry.game)

    if (firstTimestamp != null && secondTimestamp != null && firstTimestamp !== secondTimestamp) {
      return firstTimestamp - secondTimestamp
    }

    if (firstTimestamp != null && secondTimestamp == null) {
      return -1
    }

    if (firstTimestamp == null && secondTimestamp != null) {
      return 1
    }

    return secondEntry.index - firstEntry.index
  }

  function getChronologicalGameEntries(games) {
    if (!Array.isArray(games)) {
      return []
    }

    return games
      .map((game, index) => ({ game, index }))
      .sort(comparePlayoffEntriesChronologically)
  }

  function shouldStartNextPlayoffSeries(currentSeries, nextEntry) {
    if (!currentSeries) {
      return true
    }

    const nextOpponentKey = getPlayoffOpponentKey(nextEntry.game)
    const previousEntry = currentSeries.entries[currentSeries.entries.length - 1]
    const previousTimestamp = getPlayoffGameTimestamp(previousEntry?.game)
    const nextTimestamp = getPlayoffGameTimestamp(nextEntry.game)
    const daysSincePreviousGame = previousTimestamp != null && nextTimestamp != null
      ? (nextTimestamp - previousTimestamp) / (1000 * 60 * 60 * 24)
      : 0

    if (currentSeries.roundIndex != null && nextEntry.roundIndex != null) {
      return currentSeries.roundIndex !== nextEntry.roundIndex
    }

    if (currentSeries.opponentKey && nextOpponentKey) {
      return currentSeries.opponentKey !== nextOpponentKey
    }

    return currentSeries.entries.length >= 7 || daysSincePreviousGame > 5
  }

  function buildPlayoffSeriesBuckets(playoffGames) {
    const chronologicalEntries = playoffGames
      .map((game, index) => ({
        game,
        index,
        roundIndex: getPlayoffRoundIndex(game),
      }))
      .sort(comparePlayoffEntriesChronologically)
    const seriesBuckets = []

    chronologicalEntries.forEach(entry => {
      const opponentKey = getPlayoffOpponentKey(entry.game)
      const shouldCreateSeries = shouldStartNextPlayoffSeries(seriesBuckets[seriesBuckets.length - 1], entry)

      if (shouldCreateSeries) {
        seriesBuckets.push({
          opponentKey,
          roundIndex: entry.roundIndex,
          entries: [],
        })
      }

      const activeSeries = seriesBuckets[seriesBuckets.length - 1]

      if (!activeSeries.opponentKey && opponentKey) {
        activeSeries.opponentKey = opponentKey
      }

      if (activeSeries.roundIndex == null && entry.roundIndex != null) {
        activeSeries.roundIndex = entry.roundIndex
      }

      activeSeries.entries.push(entry)
    })

    return seriesBuckets
  }

  function getPostSeasonGameLogRows(playInGames, playoffGames, dateSortDirection = "asc") {
    const rows = []
    const chronologicalPlayInEntries = getChronologicalGameEntries(playInGames)
    const renderedPlayInEntries = dateSortDirection === "desc"
      ? [...chronologicalPlayInEntries].reverse()
      : chronologicalPlayInEntries

    function pushPlayInRows() {
      if (renderedPlayInEntries.length === 0) {
        return
      }

      const firstGameTeams = getPlayoffMatchupTeams(renderedPlayInEntries[0].game)

      rows.push({
        type: "group",
        key: "playin-group",
        label: getPlayInRoundLabel(firstGameTeams.playerTeam?.conference),
        count: renderedPlayInEntries.length,
      })

      renderedPlayInEntries.forEach(({ game, index }) => {
        rows.push({
          type: "game",
          key: `playin-${getGameLogKey(game, index)}-row`,
          game,
          index,
        })
      })

      const playInAverages = getGameLogAverages(playInGames)

      if (playInAverages) {
        rows.push({
          type: "groupAverage",
          key: "playin-avg",
          averages: playInAverages,
        })
      }
    }

    const playoffSeriesBuckets = Array.isArray(playoffGames) && playoffGames.length > 0
      ? buildPlayoffSeriesBuckets(playoffGames).map((series, seriesIndex) => ({ ...series, seriesIndex }))
      : []
    const renderedPlayoffSeries = dateSortDirection === "desc"
      ? [...playoffSeriesBuckets].reverse()
      : playoffSeriesBuckets

    if (dateSortDirection !== "desc") {
      pushPlayInRows()
    }

    if (renderedPlayoffSeries.length === 0) {
      if (dateSortDirection === "desc") {
        pushPlayInRows()
      }

      return rows
    }

    renderedPlayoffSeries.forEach(series => {
      if (!series.entries || series.entries.length === 0) {
        return
      }

      const roundIndex = series.roundIndex ?? series.seriesIndex
      const renderedSeriesEntries = dateSortDirection === "desc"
        ? [...series.entries].reverse()
        : series.entries
      const firstGameTeams = getPlayoffMatchupTeams(renderedSeriesEntries[0].game)

      rows.push({
        type: "group",
        key: `playoff-round-${roundIndex}-${series.seriesIndex}-group`,
        label: getPlayoffRoundLabel(roundIndex, firstGameTeams.playerTeam?.conference),
        count: series.entries.length,
      })

      renderedSeriesEntries.forEach(({ game, index }) => {
        rows.push({
          type: "game",
          key: `playoff-round-${roundIndex}-${series.seriesIndex}-${getGameLogKey(game, index)}-row`,
          game,
          index,
        })
      })

      const seriesAverages = getGameLogAverages(series.entries.map(({ game }) => game))

      if (seriesAverages) {
        rows.push({
          type: "groupAverage",
          key: `playoff-round-${roundIndex}-${series.seriesIndex}-avg`,
          averages: seriesAverages,
        })
      }
    })

    if (dateSortDirection === "desc") {
      pushPlayInRows()
    }

    return rows
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

  function getDidNotPlayMessage(seasonLabel, postseason = false) {
    const playerName = data?.name || "This player"
    const resolvedSeason = seasonLabel || "the selected season"
    return postseason
      ? `${playerName} did not play in the ${resolvedSeason} playoffs.`
      : `${playerName} did not play in the ${resolvedSeason} season.`
  }

  const tabs = [
    { id: "season", label: "Season" },
    { id: "games", label: "Game Logs" },
    { id: "career", label: "Game Highs" },
    { id: "advanced", label: "Advanced" },
    { id: "comments", label: "Comments" },
  ]

  function getSeasonStartYear(seasonId) {
    const startYear = Number.parseInt(String(seasonId).split("-")[0], 10)
    if (Number.isNaN(startYear)) {
      return null
    }

    if (startYear < 100) {
      return startYear >= 47 ? 1900 + startYear : 2000 + startYear
    }

    return startYear
  }

  function compareSeasonIdsDescending(firstSeasonId, secondSeasonId) {
    const firstStartYear = getSeasonStartYear(firstSeasonId)
    const secondStartYear = getSeasonStartYear(secondSeasonId)

    if (firstStartYear !== null && secondStartYear !== null) {
      return secondStartYear - firstStartYear
    }

    if (firstStartYear !== null) {
      return -1
    }

    if (secondStartYear !== null) {
      return 1
    }

    return String(secondSeasonId).localeCompare(String(firstSeasonId))
  }

  function getSortedSeasonOptions(seasonIds) {
    const normalizedSeasonIds = seasonIds
      .map(seasonId => String(seasonId ?? "").trim())
      .filter(Boolean)

    return Array.from(new Set(normalizedSeasonIds)).sort(compareSeasonIdsDescending)
  }

  const defaultSeason = isPostSeason ? data.playoff_season || data.playin_season || "" : data.season || ""
  const availableGameLogSeasons = isPostSeason
    ? (Array.isArray(data.available_playoff_game_log_seasons) ? data.available_playoff_game_log_seasons : [])
    : (Array.isArray(data.available_game_log_seasons) ? data.available_game_log_seasons : [])
  const availablePlayInGameLogSeasons = isPostSeason
    ? (Array.isArray(data.available_playin_game_log_seasons) ? data.available_playin_game_log_seasons : [])
    : []
  const seasonGameLogs = isPostSeason ? data.playoff_season_game_logs || {} : data.season_game_logs || {}
  const playInSeasonGameLogs = isPostSeason ? data.playin_season_game_logs || {} : {}
  const seasonStatsBySeason = isPostSeason ? data.playoff_season_stats_by_season || {} : data.season_stats_by_season || {}
  const availableStatSeasons = isPostSeason
    ? (Array.isArray(data.available_playoff_stat_seasons) ? data.available_playoff_stat_seasons : [])
    : (Array.isArray(data.available_stat_seasons) ? data.available_stat_seasons : [])
  const seasonSelectorOptions = getSortedSeasonOptions([
    ...availableGameLogSeasons,
    ...availablePlayInGameLogSeasons,
    ...availableStatSeasons,
  ])
  const activeGameLogSeason = selectedGameLogSeason || seasonSelectorOptions[0] || defaultSeason
  const activeSeason = activeGameLogSeason || availableStatSeasons[0] || defaultSeason
  const defaultSeasonStats = isPostSeason ? data.playoff_season_stats : data.season_stats
  const hasActiveSeasonStatsEntry = Object.prototype.hasOwnProperty.call(
    seasonStatsBySeason,
    activeGameLogSeason
  )
  const activeSeasonStats = hasActiveSeasonStatsEntry
    ? seasonStatsBySeason[activeGameLogSeason]
    : (!activeGameLogSeason || activeGameLogSeason === defaultSeason
      ? (defaultSeasonStats || {})
      : {})
  const defaultSeasonGameLog = isPostSeason ? data.playoff_season_game_log : data.season_game_log
  const defaultPlayInSeason = isPostSeason ? data.playin_season || "" : ""
  const defaultPlayInSeasonGameLog = isPostSeason ? data.playin_season_game_log : []
  const activeSeasonGameLog = Array.isArray(seasonGameLogs[activeGameLogSeason])
    ? seasonGameLogs[activeGameLogSeason]
    : Array.isArray(defaultSeasonGameLog) && activeGameLogSeason === defaultSeason
      ? defaultSeasonGameLog
      : []
  const activePlayInSeasonGameLog = Array.isArray(playInSeasonGameLogs[activeGameLogSeason])
    ? playInSeasonGameLogs[activeGameLogSeason]
    : Array.isArray(defaultPlayInSeasonGameLog) && activeGameLogSeason === defaultPlayInSeason
      ? defaultPlayInSeasonGameLog
      : []
  const activePostSeasonGameLog = isPostSeason
    ? [...activeSeasonGameLog, ...activePlayInSeasonGameLog]
    : activeSeasonGameLog
  const sortedActiveSeasonGameLogEntries = getSortedGameLogEntries(activeSeasonGameLog, gameLogDateSortDirection)
  const groupedGameLogRows = isPostSeason
    ? getPostSeasonGameLogRows(activePlayInSeasonGameLog, activeSeasonGameLog, gameLogDateSortDirection)
    : getGroupedGameLogRows(sortedActiveSeasonGameLogEntries, splitMode)
  const totalDisplayedGameLogCount = isPostSeason
    ? activePlayInSeasonGameLog.length + activeSeasonGameLog.length
    : activeSeasonGameLog.length
  const gameLogAverages = isPostSeason ? null : getGameLogAverages(activeSeasonGameLog)
  const fallbackLastGame = isPostSeason ? data.playoff_last_game : data.last_game
  const fallbackLastFiveGames = isPostSeason ? data.playoff_last_5_games : data.last_5_games
  const activeLastGame = activePostSeasonGameLog[0] || fallbackLastGame || null
  const activeLastFiveGames = activePostSeasonGameLog.length > 0
    ? activePostSeasonGameLog.slice(0, 5)
    : (Array.isArray(fallbackLastFiveGames) ? fallbackLastFiveGames.slice(0, 5) : [])
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
  const gameHighSeasonOptions = [
    "all-time",
    ...getSortedSeasonOptions([
      ...availableGameLogSeasons,
      ...availablePlayInGameLogSeasons,
      ...Object.keys(seasonGameLogs || {}),
      ...Object.keys(playInSeasonGameLogs || {}),
    ]),
  ]
  const activeGameHighSeason = gameHighSeasonOptions.includes(selectedGameHighSeason)
    ? selectedGameHighSeason
    : "all-time"
  const allTimeGameEntries = gameHighSeasonOptions
    .filter(seasonId => seasonId !== "all-time")
    .flatMap(seasonId => {
      const playoffGames = Array.isArray(seasonGameLogs?.[seasonId]) ? seasonGameLogs[seasonId] : []
      const playInGames = Array.isArray(playInSeasonGameLogs?.[seasonId]) ? playInSeasonGameLogs[seasonId] : []

      return [...playoffGames, ...playInGames].map((game, index) => ({ seasonId: String(seasonId), game, index }))
    })
  const selectedGameHighEntries = activeGameHighSeason === "all-time"
    ? allTimeGameEntries
    : [
      ...(Array.isArray(seasonGameLogs?.[activeGameHighSeason]) ? seasonGameLogs[activeGameHighSeason] : []),
      ...(Array.isArray(playInSeasonGameLogs?.[activeGameHighSeason]) ? playInSeasonGameLogs[activeGameHighSeason] : []),
    ].map((game, index) => ({
      seasonId: activeGameHighSeason,
      game,
      index,
    }))
  const careerGameHighsByStat = getGameHighsByStat(allTimeGameEntries, gameHighStatCategories)
  const selectedGameHighsByStat = getGameHighsByStat(selectedGameHighEntries, gameHighStatCategories)
  const hasActiveSeasonStats = Number(activeSeasonStats?.gp || 0) > 0
  const noPostSeasonData = isPostSeason &&
    availableGameLogSeasons.length === 0 &&
    availablePlayInGameLogSeasons.length === 0 &&
    availableStatSeasons.length === 0

  function renderPostSeasonToggle() {
    return (
      <div className="flex flex-col items-center gap-2 text-sm text-slate-300">
        <span className="whitespace-nowrap text-center text-xs uppercase tracking-[0.22em] text-slate-400">Post-Season</span>
        <button
          type="button"
          onClick={() => setIsPostSeason(current => !current)}
          aria-pressed={isPostSeason}
          aria-label="Toggle postseason view"
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-all duration-300 ${
            isPostSeason
              ? "border-blue-300/35 bg-blue-400/20 text-blue-100 hover:bg-blue-400/25"
              : "border-white/10 bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-200"
          }`}
        >
          {isPostSeason && (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M16.704 5.29a1 1 0 0 1 .006 1.414l-8 8a1 1 0 0 1-1.42-.005l-4-4a1 1 0 1 1 1.415-1.414l3.293 3.293 7.294-7.294a1 1 0 0 1 1.412.006Z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>
      </div>
    )
  }

  function toggleGameLogDateSortDirection() {
    setGameLogDateSortDirection(currentDirection => currentDirection === "asc" ? "desc" : "asc")
  }

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
    if (!targetGame || activePostSeasonGameLog.length === 0) {
      return -1
    }

    const directMatchIndex = activePostSeasonGameLog.findIndex(game => game === targetGame)

    if (directMatchIndex >= 0) {
      return directMatchIndex
    }

    if (targetGame.game_id) {
      return activePostSeasonGameLog.findIndex(game => game?.game_id === targetGame.game_id)
    }

    return activePostSeasonGameLog.findIndex(game =>
      game?.game_date === targetGame.game_date &&
      game?.date === targetGame.date &&
      game?.matchup === targetGame.matchup
    )
  }

  const activeLastGameIndex = findGameLogIndex(activeLastGame)
  const playerName = data?.name || "Player"
  const playerTeamName = getExpandedTeamName(data?.team) || "-"
  const playerTeamLogoUrl = getTeamLogoUrl(data?.team)
  const playerHeadshotUrl = data?.headshot_url || `https://cdn.nba.com/headshots/nba/latest/1040x760/${normalizedPlayerId}.png`

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
                      src={playerHeadshotUrl}
                      alt={playerName}
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
                      {playerName}
                    </h1>
                    <p className="mt-2 text-sm text-slate-300 sm:text-base">
                      {isPostSeason ? "PS" : "Season"} {activeSeason || "-"} • {formatNumber(activeSeasonStats?.gp, 0)} games played
                    </p>
                    <p className="mt-1 inline-flex flex-wrap items-center justify-center gap-2 text-sm text-slate-300 sm:justify-start sm:text-base">
                      <span>Plays for: {playerTeamName}</span>
                      {playerTeamLogoUrl ? (
                        <img
                          src={playerTeamLogoUrl}
                          alt={`${playerTeamName} logo`}
                          className="h-6 w-6 object-contain"
                          loading="lazy"
                          onError={event => {
                            event.currentTarget.style.display = "none"
                          }}
                        />
                      ) : null}
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
                        {isPostSeason && !hasActiveSeasonStats && (
                          <div className="rounded-[1.5rem] border border-dashed border-white/12 bg-slate-900/40 p-5 text-sm text-slate-400">
                            {noPostSeasonData
                              ? "This player does not have postseason stats yet."
                              : `This player has no postseason stats for ${activeSeason || activeGameLogSeason || "the selected season"}.`}
                          </div>
                        )}

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

                            <div className="mt-4 flex w-full flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                              <label className="flex w-full flex-col items-start gap-2 text-sm text-slate-300 sm:w-auto">
                                <span className="text-xs uppercase tracking-[0.22em] text-slate-400">Season</span>
                                <select
                                  value={activeGameLogSeason}
                                  onChange={event => setSelectedGameLogSeason(event.target.value)}
                                  disabled={seasonSelectorOptions.length === 0}
                                  className="min-w-36 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-left text-white outline-none transition-colors duration-300 hover:border-white/20 focus:border-blue-300/40"
                                >
                                  {seasonSelectorOptions.length > 0 ? (
                                    seasonSelectorOptions.map(season => (
                                      <option key={season} value={season}>
                                        {season}
                                      </option>
                                    ))
                                  ) : (
                                    <option value="">No seasons</option>
                                  )}
                                </select>
                              </label>
                              {renderPostSeasonToggle()}
                            </div>
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
                            {isPostSeason
                              ? getDidNotPlayMessage(activeGameLogSeason || activeSeason, true)
                              : getDidNotPlayMessage(activeGameLogSeason || activeSeason, false)}
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
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                          {isPostSeason ? "Post-Season Game Logs" : "Season Game Logs"}
                        </p>
                        <h2 className="mt-2 text-2xl font-semibold text-white">
                          {totalDisplayedGameLogCount} Games Played
                        </h2>
                        <p className="mt-2 text-sm text-slate-300">
                          {isPostSeason
                            ? "Full postseason game logs with the expanded box score breakdown for each game."
                            : "Full season game logs with the expanded box score breakdown for each game."}
                        </p>
                      </div>

                      <div className="relative flex flex-col gap-3 sm:right-[10px] sm:flex-row sm:items-end sm:gap-4">
                        {renderPostSeasonToggle()}

                        <label className="flex flex-col gap-2 text-sm text-slate-300 sm:items-start">
                          <span className="pl-2 text-xs uppercase tracking-[0.22em] text-slate-400">Season</span>
                          <select
                            value={activeGameLogSeason}
                            onChange={event => setSelectedGameLogSeason(event.target.value)}
                            disabled={seasonSelectorOptions.length === 0}
                            className="w-fit rounded-xl border border-white/10 bg-slate-950/70 pl-2 pr-1 py-2 text-white outline-none transition-colors duration-300 hover:border-white/20 focus:border-blue-300/40"
                          >
                            {seasonSelectorOptions.length > 0 ? (
                              seasonSelectorOptions.map(season => (
                                <option key={season} value={season}>
                                  {season}
                                </option>
                              ))
                            ) : (
                              <option value="">No seasons</option>
                            )}
                          </select>
                        </label>

                        {!isPostSeason && (
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
                        )}
                      </div>
                    </div>

                    {totalDisplayedGameLogCount > 0 ? (
                      <div className="mt-5 w-[calc(100%-0.5rem)] overflow-hidden rounded-[1.25rem] border border-white/10 bg-slate-950/45 pb-3">
                        <div
                          ref={gameLogScrollRef}
                          className="game-log-scroll overflow-x-auto overflow-y-hidden"
                          style={{ overscrollBehavior: "contain" }}
                        >
                          <table className="game-log-table min-w-full w-max text-left text-sm text-slate-200">
                            <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-400">
                              <tr>
                                <th
                                  className="px-4 py-3 font-medium"
                                  aria-sort={gameLogDateSortDirection === "asc" ? "ascending" : "descending"}
                                >
                                  <button
                                    type="button"
                                    onClick={toggleGameLogDateSortDirection}
                                    className="inline-flex items-center gap-1 text-left font-medium uppercase tracking-[0.18em] text-slate-400 transition-colors duration-200 hover:text-white focus:outline-none focus-visible:text-white"
                                    aria-label={`Sort game logs by date ${gameLogDateSortDirection === "asc" ? "newest first" : "oldest first"}`}
                                  >
                                    Date
                                    <span aria-hidden="true" className="text-[0.65rem] leading-none">
                                      {gameLogDateSortDirection === "asc" ? "↑" : "↓"}
                                    </span>
                                  </button>
                                </th>
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
                        {isPostSeason
                          ? getDidNotPlayMessage(activeGameLogSeason || activeSeason, true)
                          : getDidNotPlayMessage(activeGameLogSeason || activeSeason, false)}
                      </div>
                    )}
                  </div>
                )}

                {tab === "career" && (
                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/55 p-5 shadow-lg shadow-black/20">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Game Highs</p>
                      <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <h2 className="text-2xl font-semibold text-white">
                            {activeGameHighSeason === "all-time" ? "All-Time Single-Game Highs" : `Season ${activeGameHighSeason} Game Highs`}
                          </h2>
                          <p className="mt-2 text-sm text-slate-300">
                          Each category shows a single-game peak. Season highs are highlighted when they match the all-time career high.
                          </p>
                        </div>

                        <div className="flex items-start gap-4">
                          {renderPostSeasonToggle()}

                          <label className="flex w-fit flex-col gap-2 text-sm text-slate-300">
                            <span className="text-xs uppercase tracking-[0.22em] text-slate-400">Scope</span>
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
                      </div>
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
                        {isPostSeason
                          ? (noPostSeasonData
                            ? "This player has no postseason game data yet, so playoff game highs are unavailable."
                            : `No postseason game logs are available for ${activeGameHighSeason === "all-time" ? "the selected scope" : activeGameHighSeason}.`)
                          : "Game log data is not available yet, so game highs cannot be calculated."}
                      </div>
                    )}
                  </div>
                )}

                {tab === "advanced" && (
                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/55 p-8 text-center shadow-lg shadow-black/20">
                    <div className="mb-5 flex justify-center">
                      {renderPostSeasonToggle()}
                    </div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Advanced</p>
                    <h2 className="mt-3 text-2xl font-semibold text-white">Advanced metrics placeholder</h2>
                    <p className="mt-3 text-sm text-slate-300">
                      This section can hold usage, rate stats, and comparison visuals once the API returns them.
                    </p>
                  </div>
                )}

                {tab === "comments" && (
                  <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
                    <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/55 p-5 shadow-lg shadow-black/20">
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Player Comments</p>
                      <h2 className="mt-3 text-2xl font-semibold text-white">
                        {comments.length === 1 ? "1 comment" : `${comments.length} comments`}
                      </h2>
                      <p className="mt-2 text-sm text-slate-300">
                        Share quick notes, scouting thoughts, or reactions for {data.name}.
                      </p>

                      <form onSubmit={handleCommentSubmit} className="mt-5">
                        <div className="mb-3 flex items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-gradient-to-br from-blue-500/25 to-emerald-400/20 text-sm font-semibold text-white">
                            {currentProfileImage ? (
                              <img
                                src={currentProfileImage}
                                alt={`${currentUsername} profile`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              getInitials(currentUsername || currentUserEmail)
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{currentUsername}</p>
                            <p className="text-xs text-slate-400">Posting as your profile</p>
                          </div>
                        </div>

                        <textarea
                          value={commentDraft}
                          onChange={event => setCommentDraft(event.target.value)}
                          maxLength={600}
                          rows={5}
                          placeholder="Leave a comment on this player..."
                          className="w-full resize-none rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition-colors duration-300 placeholder:text-slate-500 focus:border-blue-300/50"
                        />
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <p className="text-xs text-slate-500">{commentDraft.length}/600</p>
                          <button
                            type="submit"
                            disabled={commentSubmitting || !commentDraft.trim()}
                            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition-all duration-300 hover:-translate-y-0.5 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:bg-white"
                          >
                            {commentSubmitting ? "Posting" : "Post Comment"}
                          </button>
                        </div>
                      </form>

                      {commentsError && (
                        <p className="mt-4 rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                          {commentsError}
                        </p>
                      )}
                    </div>

                    <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/55 p-5 shadow-lg shadow-black/20">
                      {commentsLoading ? (
                        <div className="rounded-2xl border border-dashed border-white/12 bg-slate-950/40 p-8 text-center">
                          <div className="mx-auto mb-4 h-10 w-10 rounded-full border-4 border-blue-400/30 border-t-blue-300 animate-spin" />
                          <p className="text-sm font-medium text-white">Loading comments</p>
                        </div>
                      ) : comments.length > 0 ? (
                        <div className={`grid gap-3 ${comments.length > 4 ? "comments-scroll overflow-y-auto pr-2" : ""}`}>
                          {comments.map(comment => (
                            <article
                              key={comment.id || `${comment.username}-${comment.created_at}`}
                              className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                            >
                              <div className="flex items-start gap-3">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-gradient-to-br from-blue-500/25 to-emerald-400/20 text-sm font-semibold text-white">
                                  {comment.profile_image ? (
                                    <img
                                      src={comment.profile_image}
                                      alt={`${comment.username || "User"} profile`}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    getInitials(comment.username)
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                      <p className="font-semibold text-white">{comment.username || "Netric User"}</p>
                                      <p className="text-xs text-slate-500">{formatRelativeTime(comment.created_at, relativeTimeNow)}</p>
                                    </div>
                                    {comment.can_delete && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteComment(comment.id)}
                                        disabled={deletingCommentId === comment.id}
                                        className="rounded-lg border border-rose-300/20 bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-100 transition-colors duration-300 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {deletingCommentId === comment.id ? "Deleting" : "Delete"}
                                      </button>
                                    )}
                                  </div>
                                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                                    {comment.text}
                                  </p>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/12 bg-slate-950/40 p-8 text-center">
                          <p className="text-sm font-medium text-white">No comments yet</p>
                          <p className="mt-2 text-sm text-slate-400">
                            Be the first to leave a comment on {data.name}.
                          </p>
                        </div>
                      )}
                    </div>
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
