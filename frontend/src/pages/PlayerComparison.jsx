import { useEffect, useMemo, useState } from "react"
import ReturnHome from "../components/ReturnHome"
import ComparisonControls from "../components/playerComparison/ComparisonControls"
import ComparisonStatRows from "../components/playerComparison/ComparisonStatRows"
import PlayerSelector from "../components/playerComparison/PlayerSelector"
import {
  getAvailableComparisonSeasons,
  getComparisonStatLine,
  getSortedSeasonOptions,
  hasPlayInStatsForSeason,
  hasPlayoffStatsForSeason,
} from "../components/playerComparison/comparisonStats"

function getScopeLabel(postseason, includePlayIn) {
  if (postseason && includePlayIn) {
    return "playoffs and play-in"
  }

  if (postseason) {
    return "playoffs"
  }

  if (includePlayIn) {
    return "play-in"
  }

  return "season"
}

function getMissingScopeMessages(player, season, postseason, includePlayIn) {
  if (!player) {
    return []
  }

  const messages = []

  if (!season) {
    if (postseason) {
      messages.push(`${player.name} did not play in the playoffs.`)
    }

    if (includePlayIn) {
      messages.push(`${player.name} did not play in the play-in.`)
    }

    return messages
  }

  if (postseason && !hasPlayoffStatsForSeason(player, season)) {
    messages.push(`${player.name} did not play in the ${season} playoffs.`)
  }

  if (includePlayIn && !hasPlayInStatsForSeason(player, season)) {
    messages.push(`${player.name} did not play in the ${season} play-in.`)
  }

  return messages
}

function ScopeWarnings({ player, season, statLine, postseason, includePlayIn }) {
  if (!player) {
    return null
  }

  const missingScopeMessages = getMissingScopeMessages(player, season, postseason, includePlayIn)
  const messages = statLine
    ? missingScopeMessages
    : missingScopeMessages.length > 0
      ? missingScopeMessages
      : season
        ? [`${player.name} did not play in ${season} ${getScopeLabel(postseason, includePlayIn)}.`]
        : []

  if (messages.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      {messages.map(message => (
        <div key={message} className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {message}
        </div>
      ))}
    </div>
  )
}

export default function PlayerComparison() {
  const [leftPlayer, setLeftPlayer] = useState(null)
  const [rightPlayer, setRightPlayer] = useState(null)
  const [leftSeason, setLeftSeason] = useState("")
  const [rightSeason, setRightSeason] = useState("")
  const [postseason, setPostseason] = useState(false)
  const [includePlayIn, setIncludePlayIn] = useState(false)

  const showPlayInToggle = true
  const leftAvailableSeasonOptions = useMemo(
    () => getSortedSeasonOptions(getAvailableComparisonSeasons(leftPlayer, postseason, includePlayIn)),
    [leftPlayer, postseason, includePlayIn]
  )
  const rightAvailableSeasonOptions = useMemo(
    () => getSortedSeasonOptions(getAvailableComparisonSeasons(rightPlayer, postseason, includePlayIn)),
    [rightPlayer, postseason, includePlayIn]
  )
  const comparisonScopeSeasonOptions = useMemo(
    () => getSortedSeasonOptions([
      ...leftAvailableSeasonOptions,
      ...rightAvailableSeasonOptions,
    ]),
    [leftAvailableSeasonOptions, rightAvailableSeasonOptions]
  )
  const canUseComparisonSeasonContext = postseason || includePlayIn
  const leftSeasonOptions = leftAvailableSeasonOptions.length > 0 || !leftPlayer || !canUseComparisonSeasonContext
    ? leftAvailableSeasonOptions
    : comparisonScopeSeasonOptions
  const rightSeasonOptions = rightAvailableSeasonOptions.length > 0 || !rightPlayer || !canUseComparisonSeasonContext
    ? rightAvailableSeasonOptions
    : comparisonScopeSeasonOptions

  useEffect(() => {
    if (leftSeasonOptions.length === 0) {
      setLeftSeason("")
      return
    }

    if (!leftSeasonOptions.includes(leftSeason)) {
      setLeftSeason(leftSeasonOptions[0])
    }
  }, [leftSeason, leftSeasonOptions])

  useEffect(() => {
    if (rightSeasonOptions.length === 0) {
      setRightSeason("")
      return
    }

    if (!rightSeasonOptions.includes(rightSeason)) {
      setRightSeason(rightSeasonOptions[0])
    }
  }, [rightSeason, rightSeasonOptions])

  const leftStats = getComparisonStatLine(leftPlayer, leftSeason, postseason, includePlayIn)
  const rightStats = getComparisonStatLine(rightPlayer, rightSeason, postseason, includePlayIn)

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.18),_transparent_24%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,1))]" />
      <div className="absolute left-[-6rem] top-16 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl animate-float-slow" />
      <div className="absolute bottom-8 right-[-4rem] h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl animate-float-delayed" />

      <div className="relative mx-auto max-w-6xl">
        <div className="mb-6 flex justify-end">
          <ReturnHome className="border border-white/10 bg-white/10 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15" />
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/35 backdrop-blur-2xl animate-fade-up sm:p-8 lg:p-10">
          <div className="flex flex-col gap-8">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.25em] text-blue-200">
                Player Comparison
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Compare players by season
              </h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">
                Pick two players, choose a season, and compare the same stats side by side.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <PlayerSelector
                label="Player 1"
                selectedPlayer={leftPlayer}
                excludedPlayerId={rightPlayer?.player_id}
                onSelect={setLeftPlayer}
                onClear={() => setLeftPlayer(null)}
              />
              <PlayerSelector
                label="Player 2"
                selectedPlayer={rightPlayer}
                excludedPlayerId={leftPlayer?.player_id}
                onSelect={setRightPlayer}
                onClear={() => setRightPlayer(null)}
              />
            </div>

            <ComparisonControls
              leftPlayer={leftPlayer}
              rightPlayer={rightPlayer}
              leftSeason={leftSeason}
              rightSeason={rightSeason}
              leftSeasonOptions={leftSeasonOptions}
              rightSeasonOptions={rightSeasonOptions}
              postseason={postseason}
              includePlayIn={includePlayIn}
              showPlayInToggle={showPlayInToggle}
              onLeftSeasonChange={setLeftSeason}
              onRightSeasonChange={setRightSeason}
              onPostseasonChange={setPostseason}
              onPlayInChange={setIncludePlayIn}
            />

            {(leftPlayer || rightPlayer) && (
              <div className="grid gap-3 lg:grid-cols-2">
                <ScopeWarnings
                  player={leftPlayer}
                  season={leftSeason}
                  statLine={leftStats}
                  postseason={postseason}
                  includePlayIn={includePlayIn}
                />
                <ScopeWarnings
                  player={rightPlayer}
                  season={rightSeason}
                  statLine={rightStats}
                  postseason={postseason}
                  includePlayIn={includePlayIn}
                />
              </div>
            )}

            <ComparisonStatRows
              leftPlayer={leftPlayer}
              rightPlayer={rightPlayer}
              leftStats={leftStats}
              rightStats={rightStats}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
