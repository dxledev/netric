import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import ReturnHome from "../components/ReturnHome"
import { API_BASE } from "../api"
import { normalizeSearchFilter } from "../utils/searchText"

export default function Teams() {
  const navigate = useNavigate()
  const [teams, setTeams] = useState([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let ignore = false

    axios
      .get(`${API_BASE}/teams`)
      .then(res => {
        if (!ignore) {
          setTeams(Array.isArray(res.data?.teams) ? res.data.teams : [])
          setError("")
        }
      })
      .catch(err => {
        if (!ignore) {
          setError("Unable to load teams right now.")
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

  const filteredTeams = useMemo(() => {
    const normalizedQuery = normalizeSearchFilter(query)
    if (!normalizedQuery) {
      return teams
    }

    return teams.filter(team => (
      normalizeSearchFilter(`${team.name} ${team.abbreviation} ${team.city} ${team.nickname}`)
        .includes(normalizedQuery)
    ))
  }, [query, teams])

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex justify-end">
          <ReturnHome className="border border-white/10 bg-white/10 transition-all duration-300 hover:bg-white/15" />
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/35 sm:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-blue-200">Teams</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">NBA Teams</h1>
            </div>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search teams"
              className="w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition-colors duration-300 placeholder:text-slate-500 focus:border-blue-300/50 md:max-w-sm"
            />
          </div>

          {error && (
            <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          )}

          {loading ? (
            <div className="mt-8 rounded-2xl border border-white/10 bg-slate-900/50 p-10 text-center text-slate-300">
              Loading teams
            </div>
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTeams.map(team => (
                <button
                  key={team.team_id}
                  onClick={() => navigate(`/teams/${team.team_id}`)}
                  className="rounded-2xl border border-white/10 bg-slate-900/65 p-5 text-left shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-300/40 hover:bg-slate-900"
                >
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{team.abbreviation}</p>
                  <p className="mt-3 text-xl font-semibold text-white">{team.name}</p>
                  <p className="mt-1 text-sm text-slate-400">{team.city}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
