import { useEffect, useMemo, useState } from "react"
import axios from "axios"

import { API_BASE } from "../api"
import Court from "./Court"
import { buildShotChart } from "../utils/shotChart"

const POLL_INTERVAL_MS = 2500
const MAX_PENDING_ATTEMPTS = 30

function waitForNextPoll(signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout)
      signal.removeEventListener("abort", onAbort)
      reject(new DOMException("Request aborted", "AbortError"))
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, POLL_INTERVAL_MS)
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

export default function GameShotChart({ playerId, game, season }) {
  const gameId = game?.game_id || ""
  const requestKey = `${playerId || ""}:${gameId}:${season || ""}`
  const [retryCount, setRetryCount] = useState(0)
  const [result, setResult] = useState({ requestKey, status: "loading", shots: [] })

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    setResult({ requestKey, status: "loading", shots: [] })

    async function loadShots() {
      if (!playerId || !gameId) {
        setResult({ requestKey, status: "error", shots: [] })
        return
      }

      try {
        for (let attempt = 0; attempt < MAX_PENDING_ATTEMPTS; attempt += 1) {
          const response = await axios.get(
            `${API_BASE}/players/${playerId}/games/${gameId}/shots`,
            { params: { season }, signal },
          )
          const payload = response.data || {}

          if (payload.status === "ready") {
            if (!signal.aborted) {
              setResult({ requestKey, status: "ready", shots: Array.isArray(payload.shots) ? payload.shots : [] })
            }
            return
          }

          if (payload.status === "unavailable") {
            if (!signal.aborted) {
              setResult({ requestKey, status: "unavailable", shots: [] })
            }
            return
          }

          if (payload.status !== "pending") {
            if (!signal.aborted) {
              setResult({ requestKey, status: "error", shots: [] })
            }
            return
          }

          const fetchStatus = payload.fetch_status
          if (!signal.aborted) {
            setResult({ requestKey, status: "pending", fetchStatus, polling: fetchStatus !== "retrying", shots: [] })
          }

          // A retrying response means the backend is honoring its retry schedule.
          // Let the user check again manually instead of polling through the backoff.
          if (fetchStatus === "retrying") return

          if (attempt === MAX_PENDING_ATTEMPTS - 1) {
            if (!signal.aborted) {
              setResult({ requestKey, status: "pending", fetchStatus, polling: false, shots: [] })
            }
            return
          }

          await waitForNextPoll(signal)
        }
      } catch {
        if (!signal.aborted) {
          setResult({ requestKey, status: "error", shots: [] })
        }
      }
    }

    loadShots()
    return () => controller.abort()
  }, [gameId, playerId, requestKey, retryCount, season])

  const activeResult = result.requestKey === requestKey
    ? result
    : { status: "loading", shots: [] }
  const chart = useMemo(
    () => buildShotChart(activeResult.status === "ready" ? activeResult.shots : []),
    [activeResult.status, activeResult.shots],
  )
  const hasShots = chart.shots.length > 0
  const noAttempts = Number(game?.fga) === 0

  let footer = "Shot locations are loading."
  if (activeResult.status === "pending") {
    if (activeResult.fetchStatus === "queued") {
      footer = "Shot locations are queued for fetching."
    } else if (activeResult.fetchStatus === "fetching") {
      footer = "Shot locations are being fetched."
    } else if (activeResult.fetchStatus === "retrying") {
      footer = "Shot locations could not be retrieved. A retry is scheduled."
    } else {
      footer = "Shot locations are still loading."
    }
  } else if (activeResult.status === "error") {
    footer = "Shot locations could not be loaded. Try again."
  } else if (activeResult.status === "unavailable") {
    footer = "Shot locations are unavailable for this game."
  } else if (activeResult.status === "ready" && !hasShots) {
    footer = noAttempts
      ? "No field goal attempts were recorded in this game."
      : "This game has no recorded shot locations."
  } else if (activeResult.status === "ready") {
    footer = "Shot locations show where each field goal attempt was taken."
  }

  const canRetry = (activeResult.status === "pending" && !activeResult.polling)
    || activeResult.status === "error"
    || activeResult.status === "unavailable"

  return (
    <figure className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-900/60 shadow-lg shadow-black/20">
      <figcaption className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 p-5 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Shot chart</h2>
          <p className="mt-1 text-sm text-slate-400">Every field goal attempt from this game.</p>
        </div>
        <div className="flex items-center gap-4 pt-1 text-sm tabular-nums text-slate-300">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-400" aria-hidden="true" />
            {chart.made} made
          </span>
          <span className="flex items-center gap-1.5">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 text-red-400" aria-hidden="true">
              <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {chart.missed} missed
          </span>
        </div>
      </figcaption>

      <div className="border-t border-white/10 bg-slate-900">
        <Court
          shots={chart.shots}
          dotRadius={chart.dotRadius}
          courtHeight={chart.courtHeight}
          viewHeight={chart.viewHeight}
          label={`Half-court diagram: ${chart.made} made and ${chart.missed} missed field goals`}
        />
      </div>

      {canRetry ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-3">
          <p className="text-xs text-slate-400" role="status">{footer}</p>
          <button
            type="button"
            onClick={() => setRetryCount(count => count + 1)}
            className="rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors duration-300 hover:bg-white/15"
          >
            Retry
          </button>
        </div>
      ) : (
        <p className="border-t border-white/10 px-5 py-3 text-xs text-slate-400" role="status">
          {footer}
        </p>
      )}
    </figure>
  )
}
