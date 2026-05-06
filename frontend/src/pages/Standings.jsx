import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import axios from "axios"
import ReturnHome from "../components/ReturnHome"
import { API_BASE } from "../api"

function formatWinPct(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue.toFixed(3).replace(/^0/, "") : "-"
}

function getConferenceKey(value) {
  return String(value || "").toLowerCase().startsWith("west") ? "west" : "east"
}

export default function Standings() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [standings, setStandings] = useState(null)
  const [conference, setConference] = useState(() => getConferenceKey(searchParams.get("conference")))
  const [mode, setMode] = useState("standings")
  const [round, setRound] = useState("Round One")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let ignore = false

    axios
      .get(`${API_BASE}/standings`)
      .then(res => {
        if (!ignore) {
          setStandings(res.data)
          setError("")
        }
      })
      .catch(err => {
        if (!ignore) {
          setError("Unable to load standings right now.")
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
  }, [])

  const rows = standings?.[conference] || []
  const rounds = standings?.playoffs?.rounds || []
  const activeRound = useMemo(() => (
    rounds.find(item => item.name === round) || rounds[0] || { name: round, series: [] }
  ), [round, rounds])

  useEffect(() => {
    if (rounds.length > 0 && !rounds.some(item => item.name === round)) {
      setRound(rounds[0].name)
    }
  }, [round, rounds])

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

        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/35 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-blue-200">{standings?.season || "NBA"}</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Standings</h1>
            </div>
            <div className="flex flex-wrap gap-3">
              {["east", "west"].map(tab => (
                <button
                  key={tab}
                  onClick={() => setConference(tab)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-300 ${
                    conference === tab ? "bg-white text-slate-950" : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  {tab === "east" ? "Eastern" : "Western"}
                </button>
              ))}
              {["standings", "playoffs"].map(tab => (
                <button
                  key={tab}
                  onClick={() => setMode(tab)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium capitalize transition-all duration-300 ${
                    mode === tab ? "bg-emerald-300 text-slate-950" : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          )}

          {loading ? (
            <div className="mt-8 rounded-2xl border border-white/10 bg-slate-900/50 p-10 text-center text-slate-300">Loading standings</div>
          ) : mode === "standings" ? (
            <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10">
              <table className="min-w-full divide-y divide-white/10 text-sm">
                <thead className="bg-slate-900/70 text-left text-xs uppercase tracking-[0.18em] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Team</th>
                    <th className="px-4 py-3">GB</th>
                    <th className="px-4 py-3">W-L</th>
                    <th className="px-4 py-3">PCT</th>
                    <th className="px-4 py-3">L10</th>
                    <th className="px-4 py-3">Streak</th>
                    <th className="px-4 py-3">Home</th>
                    <th className="px-4 py-3">Away</th>
                    <th className="px-4 py-3">PPG</th>
                    <th className="px-4 py-3">OPPG</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {rows.map(team => (
                    <tr
                      key={team.team_id}
                      className={team.postseason_eligible ? "bg-emerald-400/5 text-slate-100" : "text-slate-300"}
                    >
                      <td className="px-4 py-3">{team.rank}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => navigate(`/teams/${team.team_id}`)} className="font-medium text-white hover:text-blue-200">
                          {team.clinched_playoffs ? "✓ " : ""}{team.name}
                        </button>
                      </td>
                      <td className="px-4 py-3">{team.games_back}</td>
                      <td className="px-4 py-3">{team.record}</td>
                      <td className="px-4 py-3">{formatWinPct(team.win_pct)}</td>
                      <td className="px-4 py-3">{team.l10}</td>
                      <td className="px-4 py-3">{team.streak || "-"}</td>
                      <td className="px-4 py-3">{team.home_record}</td>
                      <td className="px-4 py-3">{team.away_record}</td>
                      <td className="px-4 py-3">{Number(team.ppg || 0).toFixed(1)}</td>
                      <td className="px-4 py-3">{Number(team.oppg || 0).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-8">
              <div className="flex flex-wrap gap-3">
                {rounds.map(item => (
                  <button
                    key={item.name}
                    onClick={() => setRound(item.name)}
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-300 ${
                      activeRound.name === item.name ? "bg-white text-slate-950" : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {activeRound.series.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-slate-900/40 p-8 text-slate-300">
                    No series data available for this round yet.
                  </div>
                ) : (
                  activeRound.series.map(series => (
                    <div key={`${series.conference}-${series.higher_seed}-${series.lower_seed}`} className="rounded-2xl border border-white/10 bg-slate-900/65 p-5">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{series.conference}</p>
                      <p className="mt-3 text-lg font-semibold text-white">{series.higher_seed}</p>
                      <p className="mt-1 text-sm text-slate-400">vs</p>
                      <p className="mt-1 text-lg font-semibold text-white">{series.lower_seed}</p>
                      <p className="mt-4 text-sm text-emerald-100">Series {series.series_score}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
