const PLAYER_SUMMARY_CACHE_TTL = 1000 * 60 * 30
const PLAYER_SUMMARY_CACHE_VERSION = 7
const PLAYER_SUMMARY_DATA_VERSION = 12
const REQUIRED_SEASON_STAT_KEYS = [
  "gp",
  "pts",
  "ast",
  "reb",
  "stl",
  "blk",
  "tov",
  "min_total",
  "fg_pct",
  "fg3_pct",
  "ftm",
  "fta",
  "fg2pm",
  "fg2pa",
  "ts_pct",
  "efg_pct",
]
const summaryMemoryCache = new Map()

export function getPlayerSummaryCacheKey(playerId) {
  return `netric:player-summary:${playerId}`
}

function isCacheEntryValid(cacheEntry) {
  return (
    Boolean(cacheEntry?.timestamp) &&
    cacheEntry.version === PLAYER_SUMMARY_CACHE_VERSION &&
    Date.now() - cacheEntry.timestamp <= PLAYER_SUMMARY_CACHE_TTL &&
    isPlayerSummaryUsable(cacheEntry.data)
  )
}

function getDisplaySeasonStats(summary) {
  return summary?.season_stats_by_season?.[summary?.season] || summary?.season_stats || null
}

function isPlayerSummaryUsable(summary) {
  if (!summary || summary.summary_version !== PLAYER_SUMMARY_DATA_VERSION || !summary.season) {
    return false
  }

  const seasonStats = getDisplaySeasonStats(summary)

  if (!seasonStats || Number(seasonStats.gp) <= 0) {
    return false
  }

  return REQUIRED_SEASON_STAT_KEYS.every(key => Object.prototype.hasOwnProperty.call(seasonStats, key))
}

function readFromStorage(storage, cacheKey) {
  if (!storage) {
    return null
  }

  const rawCache = storage.getItem(cacheKey)

  if (!rawCache) {
    return null
  }

  const parsedCache = JSON.parse(rawCache)

  if (!isCacheEntryValid(parsedCache)) {
    storage.removeItem(cacheKey)
    return null
  }

  return parsedCache
}

function getStorageTargets() {
  if (typeof window === "undefined") {
    return []
  }

  return [window.localStorage, window.sessionStorage]
}

export function readPlayerSummaryCache(playerId) {
  if (typeof window === "undefined") {
    return null
  }

  const cacheKey = getPlayerSummaryCacheKey(playerId)

  try {
    const memoryCache = summaryMemoryCache.get(cacheKey)

    if (isCacheEntryValid(memoryCache)) {
      return memoryCache.data ?? null
    }

    summaryMemoryCache.delete(cacheKey)
    const storages = getStorageTargets()

    for (const storage of storages) {
      const cacheEntry = readFromStorage(storage, cacheKey)

      if (!cacheEntry) {
        continue
      }

      summaryMemoryCache.set(cacheKey, cacheEntry)
      return cacheEntry.data ?? null
    }

    return null
  } catch (error) {
    console.error("Failed to read player summary cache", error)
    return null
  }
}

export function writePlayerSummaryCache(playerId, summary) {
  if (typeof window === "undefined") {
    return
  }

  if (!isPlayerSummaryUsable(summary)) {
    return
  }

  const cacheKey = getPlayerSummaryCacheKey(playerId)
  const cacheEntry = {
    timestamp: Date.now(),
    version: PLAYER_SUMMARY_CACHE_VERSION,
    data: summary,
  }

  summaryMemoryCache.set(cacheKey, cacheEntry)

  const serializedEntry = JSON.stringify(cacheEntry)

  try {
    window.localStorage.setItem(cacheKey, serializedEntry)
  } catch (error) {
    try {
      window.sessionStorage.setItem(cacheKey, serializedEntry)
    } catch (sessionError) {
      console.error("Failed to write player summary cache", sessionError)
    }
  }
}

export function clearPlayerSummaryCache(playerId) {
  if (typeof window === "undefined") {
    return
  }

  const cacheKey = getPlayerSummaryCacheKey(playerId)

  summaryMemoryCache.delete(cacheKey)
  window.localStorage.removeItem(cacheKey)
  window.sessionStorage.removeItem(cacheKey)
}
