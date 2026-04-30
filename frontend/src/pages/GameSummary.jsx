import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import axios from "axios"

import { API_BASE } from "../api"
import { readPlayerSummaryCache, writePlayerSummaryCache } from "../utils/playerSummaryCache"
import {
  findGameLogByKey,
  formatGameLogNumber,
  formatGameLogPct,
  formatSignedGameLogNumber,
} from "../utils/gameLog"

function StatCard({ label, value, accent = "" }) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-gradient-to-br ${accent} p-4 shadow-lg shadow-black/15`}
    >
      <p className="text-xs uppercase tracking-[0.22em] text-slate-300">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
    </div>
  )
}

function DetailStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition-colors duration-300 hover:bg-white/10">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  )
}

export default function GameSummary() {
  const navigate = useNavigate()
  const { id, gameKey } = useParams()
  const [searchParams] = useSearchParams()
  const cachedSummary = readPlayerSummaryCache(id)
  const [data, setData] = useState(cachedSummary)
  const [loading, setLoading] = useState(() => !cachedSummary)

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
      .catch(error => console.error(error))
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

  const requestedSeason = searchParams.get("season") || ""
  const availableGameLogSeasons = Array.isArray(data?.available_game_log_seasons) ? data.available_game_log_seasons : []
  const availablePlayoffGameLogSeasons = Array.isArray(data?.available_playoff_game_log_seasons) ? data.available_playoff_game_log_seasons : []
  const availablePlayInGameLogSeasons = Array.isArray(data?.available_playin_game_log_seasons) ? data.available_playin_game_log_seasons : []
  const availablePostSeasonGameLogSeasons = Array.from(
    new Set([...availablePlayoffGameLogSeasons, ...availablePlayInGameLogSeasons])
  )
  const activeSeason = availableGameLogSeasons.includes(requestedSeason)
    ? requestedSeason
    : availableGameLogSeasons[0] || data?.season || ""
  const seasonGames = Array.isArray(data?.season_game_logs?.[activeSeason]) ? data.season_game_logs[activeSeason] : []

  function getPostSeasonGames(seasonId) {
    const playoffGames = Array.isArray(data?.playoff_season_game_logs?.[seasonId])
      ? data.playoff_season_game_logs[seasonId]
      : []
    const playInGames = Array.isArray(data?.playin_season_game_logs?.[seasonId])
      ? data.playin_season_game_logs[seasonId]
      : []

    return [...playoffGames, ...playInGames]
  }

  const resolvedGame = useMemo(() => {
    const seasonMatch = findGameLogByKey(seasonGames, gameKey)

    if (seasonMatch) {
      return { game: seasonMatch, season: activeSeason }
    }

    for (const seasonId of availableGameLogSeasons) {
      const nextSeasonGames = Array.isArray(data?.season_game_logs?.[seasonId]) ? data.season_game_logs[seasonId] : []
      const nextMatch = findGameLogByKey(nextSeasonGames, gameKey)

      if (nextMatch) {
        return { game: nextMatch, season: seasonId }
      }
    }

    if (requestedSeason) {
      const requestedPostSeasonMatch = findGameLogByKey(getPostSeasonGames(requestedSeason), gameKey)

      if (requestedPostSeasonMatch) {
        return { game: requestedPostSeasonMatch, season: requestedSeason }
      }
    }

    for (const seasonId of availablePostSeasonGameLogSeasons) {
      const nextMatch = findGameLogByKey(getPostSeasonGames(seasonId), gameKey)

      if (nextMatch) {
        return { game: nextMatch, season: seasonId }
      }
    }

    return null
  }, [activeSeason, availableGameLogSeasons, availablePostSeasonGameLogSeasons, data, gameKey, requestedSeason, seasonGames])

  const game = resolvedGame?.game || null
  const resolvedSeason = resolvedGame?.season || activeSeason

  const primaryStats = game
    ? [
        { label: "PTS", value: formatGameLogNumber(game.pts, 0, "0"), accent: "from-blue-500/30 to-cyan-400/10" },
        { label: "REB", value: formatGameLogNumber(game.reb, 0, "0"), accent: "from-amber-500/30 to-orange-400/10" },
        { label: "AST", value: formatGameLogNumber(game.ast, 0, "0"), accent: "from-emerald-500/30 to-teal-400/10" },
        { label: "STL", value: formatGameLogNumber(game.stl, 0, "0"), accent: "from-fuchsia-500/30 to-pink-400/10" },
        { label: "BLK", value: formatGameLogNumber(game.blk, 0, "0"), accent: "from-violet-500/30 to-indigo-400/10" },
      ]
    : []

  const detailSections = game
    ? [
        {
          title: "Game Snapshot",
          description: "The core box score and on-court impact from this matchup.",
          stats: [
            { label: "MIN", value: game.min || "-" },
            { label: "Result", value: game.result || "-" },
            { label: "+/-", value: formatSignedGameLogNumber(game.plus_minus) },
            { label: "TOV", value: formatGameLogNumber(game.tov, 0, "0") },
            { label: "PF", value: formatGameLogNumber(game.pf, 0, "0") },
          ],
        },
        {
          title: "Shooting Volume",
          description: "Every made and attempted shot category.",
          stats: [
            { label: "FGM", value: formatGameLogNumber(game.fgm, 0, "0") },
            { label: "FGA", value: formatGameLogNumber(game.fga, 0, "0") },
            { label: "FG%", value: `${formatGameLogPct(game.fg_pct)}%` },
            { label: "3PM", value: formatGameLogNumber(game.three_pm, 0, "0") },
            { label: "3PA", value: formatGameLogNumber(game.three_pa, 0, "0") },
            { label: "3P%", value: `${formatGameLogPct(game.fg3_pct)}%` },
            { label: "FTM", value: formatGameLogNumber(game.ftm, 0, "0") },
            { label: "FTA", value: formatGameLogNumber(game.fta, 0, "0") },
            { label: "FT%", value: `${formatGameLogPct(game.ft_pct)}%` },
          ],
        },
        {
          title: "Efficiency",
          description: "Possession-adjusted scoring efficiency derived from the stored game log.",
          stats: [
            { label: "eFG%", value: `${formatGameLogPct(game.efg_pct)}%` },
            { label: "TS%", value: `${formatGameLogPct(game.ts_pct)}%` },
            { label: "Date", value: game.date || "-" },
            { label: "Season", value: resolvedSeason || "-" },
            { label: "Matchup", value: game.matchup || "-" },
          ],
        },
      ]
    : []

  if (!data || loading) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(34,197,94,0.18),_transparent_28%)]" />

        <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
          <div className="w-full max-w-3xl rounded-[2rem] border border-white/10 bg-white/5 p-10 text-center shadow-2xl shadow-black/30 backdrop-blur-xl animate-fade-up">
            <div className="mx-auto mb-6 h-16 w-16 rounded-full border-4 border-blue-400/30 border-t-blue-400 animate-spin" />
            <h1 className="text-3xl font-semibold tracking-tight text-white">Loading game summary</h1>
            <p className="mt-3 text-sm text-slate-300 sm:text-base">Resolving this matchup from the cached player data.</p>
          </div>
        </div>
      </div>
    )
  }

  if (!game) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_26%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,1))]" />

        <div className="relative mx-auto max-w-5xl">
          <div className="mb-6 flex justify-between gap-3">
            <button
              onClick={() => navigate(`/player/${id}?tab=games&season=${resolvedSeason}`)}
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15"
            >
              ← Back to Game Logs
            </button>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-10 text-center shadow-2xl shadow-black/35 backdrop-blur-2xl">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Game Summary</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">Game log not found</h1>
            <p className="mt-3 text-sm text-slate-300">This game is not available in the cached season logs for this player.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_26%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,1))]" />
      <div className="absolute left-[-6rem] top-20 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl animate-float-slow" />
      <div className="absolute bottom-10 right-[-5rem] h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl animate-float-delayed" />

      <div className="relative mx-auto max-w-6xl">
        <div className="mb-6 flex justify-between gap-3">
          <button
            onClick={() => navigate(`/player/${id}?tab=games&season=${resolvedSeason}`)}
            className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15"
          >
            ← Back to Game Logs
          </button>

          <button
            onClick={() => navigate("/")}
            className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15"
          >
            Return Home
          </button>
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/35 backdrop-blur-2xl animate-fade-up sm:p-8 lg:p-10">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-4">
                <div className="inline-flex w-fit items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.25em] text-blue-200">
                  Game Summary
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{game.matchup}</h1>
                  <p className="mt-2 text-sm text-slate-300 sm:text-base">
                    {data.name} • {game.date || "Date unavailable"} • Season {resolvedSeason}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-slate-200">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{game.result || "-"}</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{game.min || "-"} MIN</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    {formatSignedGameLogNumber(game.plus_minus)} +/-
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {primaryStats.map(stat => (
                  <StatCard key={stat.label} label={stat.label} value={stat.value} accent={stat.accent} />
                ))}
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="grid gap-5">
                {detailSections.slice(0, 2).map(section => (
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
                        <DetailStat key={`${section.title}-${stat.label}`} label={stat.label} value={stat.value} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-5">
                <div className="rounded-[1.5rem] border border-white/10 bg-gradient-to-br from-blue-500/12 via-slate-900/75 to-emerald-400/10 p-5 shadow-lg shadow-black/20">
                  <p className="text-xs uppercase tracking-[0.3em] text-blue-200">Quick Read</p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">
                    {formatGameLogNumber(game.pts, 0, "0")} / {formatGameLogNumber(game.reb, 0, "0")} / {formatGameLogNumber(game.ast, 0, "0")}
                  </h2>
                  <p className="mt-2 text-sm text-slate-300">
                    Scoring, rebounding, and playmaking anchored by {formatGameLogPct(game.ts_pct)}% true shooting.
                  </p>
                </div>

                <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/60 p-5 shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:border-white/15">
                  <div className="mb-5">
                    <h2 className="text-lg font-semibold text-white">{detailSections[2].title}</h2>
                    <p className="mt-1 text-sm text-slate-400">{detailSections[2].description}</p>
                  </div>

                  <div className="grid gap-3">
                    {detailSections[2].stats.map(stat => (
                      <DetailStat key={`efficiency-${stat.label}`} label={stat.label} value={stat.value} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
