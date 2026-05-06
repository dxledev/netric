import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import axios from "axios"
import ReturnHome from "../components/ReturnHome"
import { API_BASE } from "../api"
import { PLAYER_TEAM_STATS, TEAM_STATS, formatTeamValue, getPlayerScopeStats } from "../utils/teamStats"

export default function TeamInfo() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [postseason, setPostseason] = useState(false)
  const [includePlayIn, setIncludePlayIn] = useState(false)

  useEffect(() => {
    let ignore = false
    setLoading(true)

    axios
      .get(`${API_BASE}/teams/${id}/summary`)
      .then(res => {
        if (!ignore) {
          setSummary(res.data)
          setError("")
        }
      })
      .catch(err => {
        if (!ignore) {
          setError(err?.response?.status === 404 ? "Team stats are queued and will appear after the fetch worker runs." : "Unable to load team stats.")
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
  }, [id])

  const players = useMemo(() => (
    [...(summary?.players || [])].sort((left, right) => {
      const leftStats = getPlayerScopeStats(left, postseason, includePlayIn)
      const rightStats = getPlayerScopeStats(right, postseason, includePlayIn)
      return Number(rightStats?.pts || 0) - Number(leftStats?.pts || 0)
    })
  ), [includePlayIn, postseason, summary])

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex justify-between gap-3">
          <button
            onClick={() => navigate("/teams")}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition-all duration-300 hover:bg-white/10"
          >
            Teams
          </button>
          <ReturnHome className="border border-white/10 bg-white/10 transition-all duration-300 hover:bg-white/15" />
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-10 text-center text-slate-300">Loading team</div>
        ) : error ? (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-6 text-amber-100">{error}</div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/35 sm:p-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.24em] text-blue-200">{summary.team?.abbreviation} · {summary.season}</p>
                  <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{summary.team?.name}</h1>
                  <button
                    onClick={() => navigate(`/standings?conference=${summary.conference || "East"}`)}
                    className="mt-3 rounded-xl border border-emerald-300/25 bg-emerald-400/15 px-4 py-2 text-sm font-medium text-emerald-100 transition-all duration-300 hover:bg-emerald-400/20"
                  >
                    {summary.record || "0-0"} · {summary.win_streak || "-"} · {summary.standing || "Standings"}
                  </button>
                </div>
                {summary.last_game && (
                  <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Last Game</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{summary.last_game.outcome} {summary.last_game.score}</p>
                    <p className="mt-1 text-sm text-slate-300">{summary.last_game.date} · {summary.last_game.matchup}</p>
                  </div>
                )}
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              {TEAM_STATS.map(stat => (
                <div key={stat.key} className="rounded-2xl border border-white/10 bg-slate-900/65 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{stat.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{formatTeamValue(summary.stats?.[stat.key], stat.type)}</p>
                </div>
              ))}
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/25">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <h2 className="text-xl font-semibold text-white">Players</h2>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-100">
                    <input type="checkbox" checked={postseason} onChange={event => setPostseason(event.target.checked)} className="h-4 w-4 accent-blue-300" />
                    Playoffs
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-100">
                    <input type="checkbox" checked={includePlayIn} onChange={event => setIncludePlayIn(event.target.checked)} className="h-4 w-4 accent-emerald-300" />
                    Play-in
                  </label>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full divide-y divide-white/10 text-sm">
                  <thead className="text-left text-xs uppercase tracking-[0.18em] text-slate-400">
                    <tr>
                      <th className="py-3 pr-4">Player</th>
                      <th className="py-3 pr-4">No.</th>
                      <th className="py-3 pr-4">Pos</th>
                      {PLAYER_TEAM_STATS.map(stat => <th key={stat.key} className="py-3 pr-4">{stat.label}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {players.map(player => {
                      const stats = getPlayerScopeStats(player, postseason, includePlayIn)
                      return (
                        <tr key={player.player_id} className="text-slate-100">
                          <td className="py-3 pr-4 font-medium text-white">
                            <Link className="hover:text-blue-200" to={`/player/${player.player_id}`}>{player.name}</Link>
                          </td>
                          <td className="py-3 pr-4">{player.jersey_number || "-"}</td>
                          <td className="py-3 pr-4">{player.position || "-"}</td>
                          {PLAYER_TEAM_STATS.map(stat => (
                            <td key={stat.key} className="py-3 pr-4">{formatTeamValue(stats?.[stat.key], stat.type)}</td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
