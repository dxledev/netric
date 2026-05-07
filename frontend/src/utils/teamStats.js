export const TEAM_STATS = [
  { key: "pts", label: "PTS", type: "number" },
  { key: "fg_pct", label: "FG%", type: "percentage" },
  { key: "fg3_pct", label: "3FG%", type: "percentage" },
  { key: "ft_pct", label: "FT%", type: "percentage" },
  { key: "ast", label: "AST", type: "number" },
  { key: "tov", label: "TOV", type: "number" },
  { key: "oppg", label: "OPPG", type: "number" },
  { key: "ofg_pct", label: "OFG%", type: "percentage" },
  { key: "o3fg_pct", label: "O3FG%", type: "percentage" },
  { key: "blk", label: "BLK", type: "number" },
  { key: "stl", label: "STL", type: "number" },
  { key: "reb", label: "REB", type: "number" },
]

export const PLAYER_TEAM_STATS = [
  { key: "pts", label: "PTS", type: "number" },
  { key: "reb", label: "REB", type: "number" },
  { key: "ast", label: "AST", type: "number" },
  { key: "ts_pct", label: "TS%", type: "percentage" },
]

export function formatTeamValue(value, type = "number", fallback = "N/A") {
  const numberValue = Number(value)

  if (!Number.isFinite(numberValue)) {
    return fallback
  }

  if (type === "percentage") {
    return `${(numberValue * 100).toFixed(1)}%`
  }

  return numberValue.toFixed(1)
}

export function getPlayerScopeStats(player, postseason, includePlayIn) {
  const normalizeStats = stats => (toNumber(stats?.gp) > 0 ? stats : null)

  if (postseason && includePlayIn) {
    return combinePlayerStats(player?.postseason, player?.playin)
  }

  if (includePlayIn) {
    return normalizeStats(player?.playin)
  }

  if (postseason) {
    return normalizeStats(player?.postseason)
  }

  return normalizeStats(player?.regular)
}

function toNumber(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function combinePlayerStats(firstStats, secondStats) {
  if (!firstStats && !secondStats) {
    return null
  }

  if (!firstStats) {
    return secondStats
  }

  if (!secondStats) {
    return firstStats
  }

  const gp = toNumber(firstStats.gp) + toNumber(secondStats.gp)
  const ptsTotal = toNumber(firstStats.pts_total) + toNumber(secondStats.pts_total)
  const rebTotal = toNumber(firstStats.reb_total) + toNumber(secondStats.reb_total)
  const astTotal = toNumber(firstStats.ast_total) + toNumber(secondStats.ast_total)
  const fga = toNumber(firstStats.fga) + toNumber(secondStats.fga)
  const fta = toNumber(firstStats.fta) + toNumber(secondStats.fta)
  const tsAttempts = 2 * (fga + 0.44 * fta)

  if (gp <= 0) {
    return null
  }

  return {
    gp,
    pts: ptsTotal / gp,
    reb: rebTotal / gp,
    ast: astTotal / gp,
    ts_pct: tsAttempts > 0 ? ptsTotal / tsAttempts : 0,
  }
}
