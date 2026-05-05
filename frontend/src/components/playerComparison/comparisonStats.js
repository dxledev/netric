export const COMPARISON_STATS = [
  { key: "pts", label: "PTS", type: "perGame", higherIsBetter: true },
  { key: "ast", label: "AST", type: "perGame", higherIsBetter: true },
  { key: "reb", label: "REB", type: "perGame", higherIsBetter: true },
  { key: "stl", label: "STL", type: "perGame", higherIsBetter: true },
  { key: "blk", label: "BLK", type: "perGame", higherIsBetter: true },
  { key: "tov", label: "TOV", type: "perGame", higherIsBetter: false },
  { key: "min_total", label: "MIN", type: "perGame", higherIsBetter: true },
  { key: "fg_pct", label: "FG%", type: "percentage", higherIsBetter: true },
  { key: "fg3_pct", label: "3FG%", type: "percentage", higherIsBetter: true },
  { key: "ft_pct", label: "FT%", type: "percentage", higherIsBetter: true },
  { key: "fg2_pct", label: "2FG%", type: "percentage", higherIsBetter: true },
  { key: "ts_pct", label: "TS%", type: "percentage", higherIsBetter: true },
  { key: "efg_pct", label: "EFG%", type: "percentage", higherIsBetter: true },
]

const TOTAL_KEYS = [
  "gp",
  "min_total",
  "pts",
  "ast",
  "reb",
  "stl",
  "blk",
  "tov",
  "fgm",
  "fga",
  "three_pm",
  "three_pa",
  "ftm",
  "fta",
  "fg2pm",
  "fg2pa",
]

export function getSeasonStartYear(seasonId) {
  const startYear = Number.parseInt(String(seasonId).split("-")[0], 10)

  if (Number.isNaN(startYear)) {
    return null
  }

  if (startYear < 100) {
    return startYear >= 47 ? 1900 + startYear : 2000 + startYear
  }

  return startYear
}

export function compareSeasonIdsDescending(firstSeasonId, secondSeasonId) {
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

export function getSortedSeasonOptions(seasonIds) {
  return Array.from(
    new Set(
      seasonIds
        .map(seasonId => String(seasonId ?? "").trim())
        .filter(Boolean)
    )
  ).sort(compareSeasonIdsDescending)
}

function toNumber(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function parseMinutes(value) {
  if (typeof value === "string" && value.includes(":")) {
    const [minutes, seconds] = value.split(":").map(part => Number(part))

    if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
      return minutes + seconds / 60
    }
  }

  return toNumber(value)
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null
}

function calculateEfficiency(stats) {
  const fgm = toNumber(stats.fgm)
  const fga = toNumber(stats.fga)
  const threePm = toNumber(stats.three_pm)
  const fta = toNumber(stats.fta)
  const pts = toNumber(stats.pts)

  return {
    fg_pct: divide(fgm, fga),
    fg3_pct: divide(toNumber(stats.three_pm), toNumber(stats.three_pa)),
    ft_pct: divide(toNumber(stats.ftm), fta),
    fg2_pct: divide(toNumber(stats.fg2pm), toNumber(stats.fg2pa)),
    efg_pct: divide(fgm + 0.5 * threePm, fga),
    ts_pct: divide(pts, 2 * (fga + 0.44 * fta)),
  }
}

function normalizeTotals(stats) {
  const totals = {}

  TOTAL_KEYS.forEach(key => {
    totals[key] = toNumber(stats?.[key])
  })

  if (!Object.prototype.hasOwnProperty.call(stats || {}, "fg2pm")) {
    totals.fg2pm = totals.fgm - totals.three_pm
  }

  if (!Object.prototype.hasOwnProperty.call(stats || {}, "fg2pa")) {
    totals.fg2pa = totals.fga - totals.three_pa
  }

  return {
    ...totals,
    ...calculateEfficiency(totals),
  }
}

function aggregateGameLogs(games) {
  if (!Array.isArray(games) || games.length === 0) {
    return null
  }

  const totals = {
    gp: games.length,
    min_total: 0,
    pts: 0,
    ast: 0,
    reb: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    fgm: 0,
    fga: 0,
    three_pm: 0,
    three_pa: 0,
    ftm: 0,
    fta: 0,
    fg2pm: 0,
    fg2pa: 0,
  }

  games.forEach(game => {
    totals.min_total += parseMinutes(game.min)
    totals.pts += toNumber(game.pts)
    totals.ast += toNumber(game.ast)
    totals.reb += toNumber(game.reb)
    totals.stl += toNumber(game.stl)
    totals.blk += toNumber(game.blk)
    totals.tov += toNumber(game.tov)
    totals.fgm += toNumber(game.fgm)
    totals.fga += toNumber(game.fga)
    totals.three_pm += toNumber(game.three_pm)
    totals.three_pa += toNumber(game.three_pa)
    totals.ftm += toNumber(game.ftm)
    totals.fta += toNumber(game.fta)
  })

  totals.fg2pm = totals.fgm - totals.three_pm
  totals.fg2pa = totals.fga - totals.three_pa

  return {
    ...totals,
    ...calculateEfficiency(totals),
  }
}

function combineTotals(firstStats, secondStats) {
  if (!firstStats && !secondStats) {
    return null
  }

  if (!firstStats) {
    return secondStats
  }

  if (!secondStats) {
    return firstStats
  }

  const combined = {}

  TOTAL_KEYS.forEach(key => {
    combined[key] = toNumber(firstStats[key]) + toNumber(secondStats[key])
  })

  return {
    ...combined,
    ...calculateEfficiency(combined),
  }
}

export function getAvailableComparisonSeasons(summary, postseason, includePlayIn) {
  if (!summary) {
    return []
  }

  if (!postseason && !includePlayIn) {
    return getSortedSeasonOptions(summary.available_stat_seasons || [])
  }

  const playoffSeasons = Array.isArray(summary.available_playoff_stat_seasons)
    ? summary.available_playoff_stat_seasons
    : []
  const playInSeasons = Array.isArray(summary.available_playin_game_log_seasons)
    ? summary.available_playin_game_log_seasons
    : []

  return getSortedSeasonOptions([
    ...(postseason ? playoffSeasons : []),
    ...(includePlayIn ? playInSeasons : []),
  ])
}

export function hasPlayInData(summary) {
  return Array.isArray(summary?.available_playin_game_log_seasons) && summary.available_playin_game_log_seasons.length > 0
}

function getGameLogsForSeason(logsBySeason, seasonId) {
  const games = logsBySeason?.[seasonId]
  return Array.isArray(games) ? games : []
}

function getPlayInStatsForSeason(summary, seasonId) {
  return aggregateGameLogs(getGameLogsForSeason(summary?.playin_season_game_logs, seasonId))
}

function getPlayoffStatsForSeason(summary, seasonId) {
  const playoffGameLogs = getGameLogsForSeason(summary?.playoff_season_game_logs, seasonId)

  if (playoffGameLogs.length > 0) {
    return aggregateGameLogs(playoffGameLogs)
  }

  const playInGameLogs = getGameLogsForSeason(summary?.playin_season_game_logs, seasonId)
  if (playInGameLogs.length > 0) {
    return null
  }

  const playoffStats = summary.playoff_season_stats_by_season?.[seasonId]
    || (seasonId === summary.playoff_season ? summary.playoff_season_stats : null)

  return playoffStats ? normalizeTotals(playoffStats) : null
}

export function hasPlayoffStatsForSeason(summary, seasonId) {
  if (!summary || !seasonId) {
    return false
  }

  const normalizedPlayoffStats = getPlayoffStatsForSeason(summary, seasonId)

  return toNumber(normalizedPlayoffStats?.gp) > 0
}

export function hasPlayInStatsForSeason(summary, seasonId) {
  if (!summary || !seasonId) {
    return false
  }

  const playInStats = getPlayInStatsForSeason(summary, seasonId)

  return toNumber(playInStats?.gp) > 0
}

export function getComparisonStatLine(summary, seasonId, postseason, includePlayIn) {
  if (!summary || !seasonId) {
    return null
  }

  if (!postseason && !includePlayIn) {
    const regularStats = summary.season_stats_by_season?.[seasonId]
      || (seasonId === summary.season ? summary.season_stats : null)
    const normalizedStats = normalizeTotals(regularStats)

    return normalizedStats.gp > 0 ? normalizedStats : null
  }

  const normalizedPlayoffStats = postseason ? getPlayoffStatsForSeason(summary, seasonId) : null
  const playInStats = includePlayIn ? getPlayInStatsForSeason(summary, seasonId) : null

  if (toNumber(normalizedPlayoffStats?.gp) <= 0 && toNumber(playInStats?.gp) <= 0) {
    return null
  }

  const combinedStats = combineTotals(normalizedPlayoffStats, playInStats)

  return combinedStats?.gp > 0 ? combinedStats : null
}

export function getComparisonValue(stat, statLine) {
  if (!statLine) {
    return null
  }

  if (stat.type === "perGame") {
    const gamesPlayed = toNumber(statLine.gp)

    if (gamesPlayed <= 0) {
      return null
    }

    return toNumber(statLine[stat.key]) / gamesPlayed
  }

  const value = Number(statLine[stat.key])
  return Number.isFinite(value) ? value : null
}

export function formatComparisonValue(stat, value) {
  if (value == null) {
    return "-"
  }

  if (stat.type === "percentage") {
    return `${(value * 100).toFixed(1)}%`
  }

  return value.toFixed(1)
}
