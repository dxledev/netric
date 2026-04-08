import { useEffect, useState } from "react"
import axios from "axios"
import PlayerCard from "../components/PlayerCard"
import ReturnHome from "../components/ReturnHome"
import { API_BASE } from "../api"
import { writePlayerSummaryCache } from "../utils/playerSummaryCache"
import { normalizeSearchInput } from "../utils/searchText"

const CATEGORY_LABELS = {
  players: "Players",
  teams: "Teams",
  stats: "Stats",
}

export default function PlayerSearch() {
  const [name, setName] = useState("")
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [category, setCategory] = useState("players")
  const [matches, setMatches] = useState([])
  const [loadingMatches, setLoadingMatches] = useState(false)

  const searchPlayer = async inputValue => {
    const normalizedQuery = normalizeSearchInput(inputValue ?? name)

    if (!normalizedQuery) {
      return
    }

    try {
      setLoading(true)
      setError(null)
      setStats(null)

      const encodedName = encodeURIComponent(normalizedQuery)

      const fetchData = async () => {
        try {
          const res = await axios.get(`${API_BASE}/search/${category}/${encodedName}`)
          setStats(res.data)
          setMatches([])
          if (category === "players" && res.data?.player_id) {
            writePlayerSummaryCache(res.data.player_id, res.data)
          }
          setLoading(false)
        } catch (err) {
          if (err.response?.status === 404) {
            setTimeout(fetchData, 3000)
          } else {
            setError("Search failed. Try another name or category.")
            setLoading(false)
          }
        }
      }

      fetchData()
    } catch (err) {
      setError("Search failed. Try another name or category.")
      setLoading(false)
    }
  }

  useEffect(() => {
    let isCancelled = false
    const normalizedQuery = normalizeSearchInput(name)

    if (category !== "players" || !normalizedQuery) {
      setMatches([])
      setLoadingMatches(false)
      return
    }

    const timeoutId = setTimeout(async () => {
      try {
        setLoadingMatches(true)
        const encodedName = encodeURIComponent(normalizedQuery)
        const res = await axios.get(`${API_BASE}/search/players/matches/${encodedName}?limit=25`)

        if (!isCancelled) {
          setMatches(Array.isArray(res.data?.matches) ? res.data.matches : [])
        }
      } catch (err) {
        if (!isCancelled) {
          setMatches([])
        }
      } finally {
        if (!isCancelled) {
          setLoadingMatches(false)
        }
      }
    }, 250)

    return () => {
      isCancelled = true
      clearTimeout(timeoutId)
    }
  }, [name, category])

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_24%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,1))]" />
      <div className="absolute left-[-6rem] top-16 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl animate-float-slow" />
      <div className="absolute bottom-8 right-[-4rem] h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl animate-float-delayed" />

      <div className="relative mx-auto max-w-6xl">
        <div className="mb-6 flex justify-end">
          <ReturnHome className="border border-white/10 bg-white/10 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15" />
        </div>

        <div className="mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center">
          <div className="w-full max-w-5xl rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/35 backdrop-blur-2xl animate-fade-up sm:p-8 lg:p-10">
            <div className="flex flex-col gap-8">
              <div className="max-w-2xl">
                <div className="mb-3 inline-flex items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.25em] text-blue-200">
                  Search Center
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Search {CATEGORY_LABELS[category]}
                </h1>
                <p className="mt-2 text-sm text-slate-300 sm:text-base">
                  Search through our extensive database for players, teams and stat categories.
                </p>
              </div>

              <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/45 p-4 shadow-lg shadow-black/20">
                <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-white outline-none transition-colors duration-300 focus:border-blue-300/50"
                  >
                    <option value="players" className="bg-slate-900 text-white">
                      Players
                    </option>
                    <option value="teams" className="bg-slate-900 text-white">
                      Teams
                    </option>
                    <option value="stats" className="bg-slate-900 text-white">
                      Stats
                    </option>
                  </select>

                  <div className="relative">
                    <input
                      className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-white outline-none transition-colors duration-300 placeholder:text-slate-400 focus:border-blue-300/50"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      autoComplete="off"
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          searchPlayer()
                        }
                      }}
                      placeholder="Enter a name to search"
                    />

                    {category === "players" && (loadingMatches || matches.length > 0) && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-blue-300/20 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 shadow-2xl shadow-black/45 ring-1 ring-white/10 backdrop-blur">
                        {loadingMatches && (
                          <div className="px-4 py-3 text-xs text-slate-300">Finding matches...</div>
                        )}

                        {!loadingMatches && (
                          <div className="max-h-72 overflow-y-auto py-1">
                            {matches.map(match => (
                              <button
                                type="button"
                                key={match.player_id}
                                onClick={() => {
                                  setName(match.name)
                                  searchPlayer(match.name)
                                }}
                                className="flex w-full items-center justify-between bg-transparent px-4 py-2 text-left text-sm text-slate-100 transition-colors duration-200 hover:bg-blue-400/10"
                              >
                                <span className="truncate">{match.name}</span>
                                {match.is_active && (
                                  <span className="ml-3 rounded-full border border-emerald-300/30 bg-emerald-400/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200">
                                    Active
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={searchPlayer}
                    disabled={loading}
                    className={`rounded-xl px-5 py-3 text-sm font-medium transition-all duration-300 ${
                      loading
                        ? "cursor-not-allowed bg-white/10 text-slate-400"
                        : "bg-white text-slate-950 shadow-lg shadow-white/10 hover:-translate-y-0.5 hover:bg-slate-100"
                    }`}
                  >
                    {loading ? "Searching..." : "Search"}
                  </button>
                </div>
              </div>

              {loading && (
                <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/50 p-6 text-center shadow-lg shadow-black/20 animate-content-in">
                  <div className="mx-auto mb-4 h-12 w-12 rounded-full border-4 border-blue-400/30 border-t-blue-400 animate-spin" />
                  <p className="text-sm text-slate-300">
                    Waiting for the {CATEGORY_LABELS[category].toLowerCase()} result to be ready.
                  </p>
                </div>
              )}

              {error && (
                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100 animate-content-in">
                  {error}
                </div>
              )}

              {stats && !loading && (
                <div className="animate-content-in">
                  <PlayerCard {...stats} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
