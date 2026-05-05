import { useEffect, useRef, useState } from "react"
import axios from "axios"
import { API_BASE } from "../../api"
import { readPlayerSummaryCache, writePlayerSummaryCache } from "../../utils/playerSummaryCache"
import { normalizeSearchInput } from "../../utils/searchText"

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export default function PlayerSelector({ label, selectedPlayer, excludedPlayerId, onSelect, onClear }) {
  const [query, setQuery] = useState("")
  const [matches, setMatches] = useState([])
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [loadingPlayer, setLoadingPlayer] = useState(false)
  const [error, setError] = useState("")
  const activeRequestRef = useRef(0)

  useEffect(() => {
    let isCancelled = false
    const normalizedQuery = normalizeSearchInput(query)

    if (!normalizedQuery) {
      setMatches([])
      setLoadingMatches(false)
      return
    }

    const timeoutId = setTimeout(async () => {
      try {
        setLoadingMatches(true)
        const encodedName = encodeURIComponent(normalizedQuery)
        const res = await axios.get(`${API_BASE}/search/players/matches/${encodedName}?limit=10`)

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
  }, [query])

  async function fetchPlayerSummary(playerName, requestId) {
    const encodedName = encodeURIComponent(playerName)

    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const res = await axios.get(`${API_BASE}/search/players/${encodedName}`)
        return res.data
      } catch (err) {
        if (err.response?.status !== 404 || attempt === 9) {
          throw err
        }

        await wait(3000)

        if (activeRequestRef.current !== requestId) {
          return null
        }
      }
    }

    return null
  }

  async function handleSelect(match) {
    if (Number(match.player_id) === Number(excludedPlayerId)) {
      setError("Choose a different player for this side.")
      return
    }

    const requestId = activeRequestRef.current + 1
    activeRequestRef.current = requestId
    setLoadingPlayer(true)
    setError("")

    try {
      const cachedSummary = readPlayerSummaryCache(match.player_id)
      const summary = cachedSummary || await fetchPlayerSummary(match.name, requestId)

      if (!summary || activeRequestRef.current !== requestId) {
        return
      }

      if (summary.player_id) {
        writePlayerSummaryCache(summary.player_id, summary)
      }

      onSelect(summary)
      setQuery("")
      setMatches([])
    } catch (err) {
      setError("This player is not ready yet. Try another player or search again shortly.")
    } finally {
      if (activeRequestRef.current === requestId) {
        setLoadingPlayer(false)
      }
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 shadow-lg shadow-black/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{label}</p>
          {selectedPlayer ? (
            <div className="mt-3 flex items-center gap-3">
              <img
                src={selectedPlayer.headshot_url}
                alt=""
                className="h-14 w-14 rounded-xl border border-white/10 bg-slate-900 object-cover"
              />
              <div>
                <p className="text-lg font-semibold text-white">{selectedPlayer.name}</p>
                <p className="text-xs text-slate-400">{selectedPlayer.team?.abbreviation || "NBA"}</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-300">Select a player to compare.</p>
          )}
        </div>

        {selectedPlayer && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition-colors duration-200 hover:bg-white/10"
          >
            Clear
          </button>
        )}
      </div>

      <div className="relative mt-4">
        <input
          value={query}
          onChange={event => {
            setQuery(event.target.value)
            setError("")
          }}
          autoComplete="off"
          placeholder={`Search ${label.toLowerCase()}`}
          className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-white outline-none transition-colors duration-300 placeholder:text-slate-500 focus:border-blue-300/50"
        />

        {(loadingMatches || matches.length > 0) && (
          <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-blue-300/20 bg-slate-950 shadow-2xl shadow-black/45 ring-1 ring-white/10">
            {loadingMatches ? (
              <div className="px-4 py-3 text-xs text-slate-300">Finding matches...</div>
            ) : (
              <div className="max-h-64 overflow-y-auto py-1">
                {matches.map(match => {
                  const isExcluded = Number(match.player_id) === Number(excludedPlayerId)

                  return (
                    <button
                      type="button"
                      key={match.player_id}
                      onClick={() => handleSelect(match)}
                      disabled={loadingPlayer || isExcluded}
                      className={`flex w-full items-center justify-between bg-transparent px-4 py-2 text-left text-sm transition-colors duration-200 ${
                        isExcluded
                          ? "cursor-not-allowed text-slate-500"
                          : "text-slate-100 hover:bg-blue-400/10"
                      }`}
                    >
                      <span className="truncate">{match.name}</span>
                      {match.is_active && (
                        <span className="ml-3 rounded-full border border-emerald-300/30 bg-emerald-400/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200">
                          Active
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {loadingPlayer && (
        <p className="mt-3 text-xs text-blue-200">Loading player data...</p>
      )}

      {error && (
        <p className="mt-3 text-xs text-red-200">{error}</p>
      )}
    </div>
  )
}
