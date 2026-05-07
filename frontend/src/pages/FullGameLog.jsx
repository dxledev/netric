import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import axios from "axios"

import { API_BASE } from "../api"
import ReturnHome from "../components/ReturnHome"
import { formatGameLogNumber, formatGameLogPct, formatSignedGameLogNumber } from "../utils/gameLog"

function TeamStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  )
}

function formatPct(value) {
  return `${formatGameLogPct(value)}%`
}

function formatMadeAttempt(made, attempts) {
  return `${formatGameLogNumber(made, 0, "0")}/${formatGameLogNumber(attempts, 0, "0")}`
}

function playerGamePath(player, gameId, season) {
  const search = season ? `?season=${encodeURIComponent(season)}` : ""
  return `/player/${player.player_id}/games/${gameId}${search}`
}

export default function FullGameLog() {
  const { gameId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const season = searchParams.get("season") || ""
  const teamId = searchParams.get("teamId") || ""
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let ignore = false
    setLoading(true)

    axios
      .get(`${API_BASE}/games/${gameId}/summary`, { params: season ? { season } : {} })
      .then(res => {
        if (!ignore) {
          setGame(res.data)
          setError("")
        }
      })
      .catch(err => {
        if (!ignore) {
          setError(err?.response?.status === 404 ? "Game log is not cached yet." : "Unable to load game log.")
          console.error(err)
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [gameId, season])

  const teams = useMemo(() => (Array.isArray(game?.teams) ? game.teams : []), [game])
  const title = teams.length >= 2
    ? `${teams[0].abbreviation} ${teams[0].score} · ${teams[1].abbreviation} ${teams[1].score}`
    : game?.matchup || "Full Game Log"

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex justify-between gap-3">
          <button
            onClick={() => navigate(teamId ? `/teams/${teamId}` : "/teams")}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition-all duration-300 hover:bg-white/10"
          >
            Teams
          </button>
          <ReturnHome className="border border-white/10 bg-white/10 transition-all duration-300 hover:bg-white/15" />
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-10 text-center text-slate-300">Loading game log</div>
        ) : error ? (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-6 text-amber-100">{error}</div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/35 sm:p-8">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-blue-200">{game.season || season || "Season"} · {game.game_id}</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
              <p className="mt-2 text-sm text-slate-300">{game.date || "Date unavailable"} · {game.matchup || "Matchup unavailable"}</p>
            </section>

            <div className="grid gap-6 xl:grid-cols-2">
              {teams.map(team => (
                <section key={team.abbreviation} className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/25">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Team</p>
                      <h2 className="mt-2 text-2xl font-semibold text-white">{team.abbreviation}</h2>
                    </div>
                    <p className="text-4xl font-semibold text-white">{team.score}</p>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <TeamStat label="FGM/FGA" value={formatMadeAttempt(team.fgm, team.fga)} />
                    <TeamStat label="FG%" value={formatPct(team.fg_pct)} />
                    <TeamStat label="3PM/3PA" value={formatMadeAttempt(team.three_pm, team.three_pa)} />
                    <TeamStat label="3P%" value={formatPct(team.fg3_pct)} />
                    <TeamStat label="FTM/FTA" value={formatMadeAttempt(team.ftm, team.fta)} />
                    <TeamStat label="FT%" value={formatPct(team.ft_pct)} />
                    <TeamStat label="TO" value={formatGameLogNumber(team.tov, 0, "0")} />
                    <TeamStat label="REB" value={formatGameLogNumber(team.reb, 0, "0")} />
                    <TeamStat label="AST" value={formatGameLogNumber(team.ast, 0, "0")} />
                    <TeamStat label="BLK" value={formatGameLogNumber(team.blk, 0, "0")} />
                    <TeamStat label="DREB" value={formatGameLogNumber(team.dreb, 0, "0")} />
                    <TeamStat label="OREB" value={formatGameLogNumber(team.oreb, 0, "0")} />
                    <TeamStat label="STL" value={formatGameLogNumber(team.stl, 0, "0")} />
                    <TeamStat label="PF" value={formatGameLogNumber(team.pf, 0, "0")} />
                  </div>

                  <div className="mt-6 overflow-x-auto">
                    <table className="min-w-full divide-y divide-white/10 text-sm">
                      <thead className="text-left text-xs uppercase tracking-[0.16em] text-slate-400">
                        <tr>
                          <th className="py-3 pr-4">Player</th>
                          <th className="py-3 pr-4">MIN</th>
                          <th className="py-3 pr-4">PTS</th>
                          <th className="py-3 pr-4">REB</th>
                          <th className="py-3 pr-4">AST</th>
                          <th className="py-3 pr-4">STL</th>
                          <th className="py-3 pr-4">BLK</th>
                          <th className="py-3 pr-4">+/-</th>
                          <th className="py-3 pr-4">FG%</th>
                          <th className="py-3 pr-4">FGM/FGA</th>
                          <th className="py-3 pr-4">3PM/3PA</th>
                          <th className="py-3 pr-4">FTM/FTA</th>
                          <th className="py-3 pr-4">TO</th>
                          <th className="py-3 pr-4">PF</th>
                          <th className="py-3 pr-4">OREB</th>
                          <th className="py-3 pr-4">DREB</th>
                          <th className="py-3 pr-4">TS%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {(team.players || []).map(player => (
                          <tr key={`${team.abbreviation}-${player.player_id}`} className="text-slate-100">
                            <td className="py-3 pr-4 font-medium text-white">
                              {player.player_id ? (
                                <Link className="hover:text-blue-200" to={playerGamePath(player, game.game_id, game.season || season)}>
                                  {player.name}
                                </Link>
                              ) : player.name}
                            </td>
                            <td className="py-3 pr-4">{player.min || "-"}</td>
                            <td className="py-3 pr-4">{formatGameLogNumber(player.pts, 0, "0")}</td>
                            <td className="py-3 pr-4">{formatGameLogNumber(player.reb, 0, "0")}</td>
                            <td className="py-3 pr-4">{formatGameLogNumber(player.ast, 0, "0")}</td>
                            <td className="py-3 pr-4">{formatGameLogNumber(player.stl, 0, "0")}</td>
                            <td className="py-3 pr-4">{formatGameLogNumber(player.blk, 0, "0")}</td>
                            <td className="py-3 pr-4">{formatSignedGameLogNumber(player.plus_minus)}</td>
                            <td className="py-3 pr-4">{formatPct(player.fg_pct)}</td>
                            <td className="py-3 pr-4">{formatMadeAttempt(player.fgm, player.fga)}</td>
                            <td className="py-3 pr-4">{formatMadeAttempt(player.three_pm, player.three_pa)}</td>
                            <td className="py-3 pr-4">{formatMadeAttempt(player.ftm, player.fta)}</td>
                            <td className="py-3 pr-4">{formatGameLogNumber(player.tov, 0, "0")}</td>
                            <td className="py-3 pr-4">{formatGameLogNumber(player.pf, 0, "0")}</td>
                            <td className="py-3 pr-4">{formatGameLogNumber(player.oreb, 0, "0")}</td>
                            <td className="py-3 pr-4">{formatGameLogNumber(player.dreb, 0, "0")}</td>
                            <td className="py-3 pr-4">{formatPct(player.ts_pct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
