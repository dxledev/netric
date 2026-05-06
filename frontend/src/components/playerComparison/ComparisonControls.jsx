export default function ComparisonControls({
  leftPlayer,
  rightPlayer,
  leftSeason,
  rightSeason,
  leftSeasonOptions,
  rightSeasonOptions,
  postseason,
  includePlayIn,
  showPlayInToggle,
  onLeftSeasonChange,
  onRightSeasonChange,
  onPostseasonChange,
  onPlayInChange,
}) {
  const seasonControls = [
    {
      id: "left-comparison-season",
      label: leftPlayer ? `${leftPlayer.name} season` : "Player 1 season",
      value: leftSeason,
      options: leftSeasonOptions,
      onChange: onLeftSeasonChange,
      emptyText: leftPlayer ? "No seasons available" : "Select player 1 first",
    },
    {
      id: "right-comparison-season",
      label: rightPlayer ? `${rightPlayer.name} season` : "Player 2 season",
      value: rightSeason,
      options: rightSeasonOptions,
      onChange: onRightSeasonChange,
      emptyText: rightPlayer ? "No seasons available" : "Select player 2 first",
    },
  ]

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 shadow-lg shadow-black/20">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] xl:items-end">
        {seasonControls.map(control => (
          <div key={control.id}>
            <label className="text-xs uppercase tracking-[0.22em] text-slate-400" htmlFor={control.id}>
              {control.label}
            </label>
            <select
              id={control.id}
              value={control.value}
              onChange={event => control.onChange(event.target.value)}
              disabled={control.options.length === 0}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-white outline-none transition-colors duration-300 focus:border-blue-300/50 disabled:cursor-not-allowed disabled:text-slate-500"
            >
              {control.options.length === 0 ? (
                <option value="">{control.emptyText}</option>
              ) : (
                control.options.map(seasonOption => (
                  <option key={seasonOption} value={seasonOption}>
                    {seasonOption}
                  </option>
                ))
              )}
            </select>
          </div>
        ))}

        <label className="flex min-h-[46px] items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100">
          <input
            type="checkbox"
            checked={postseason}
            onChange={event => onPostseasonChange(event.target.checked)}
            className="h-4 w-4 accent-blue-300"
          />
          Playoffs
        </label>

        {showPlayInToggle && (
          <label className="flex min-h-[46px] items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100">
            <input
              type="checkbox"
              checked={includePlayIn}
              onChange={event => onPlayInChange(event.target.checked)}
              className="h-4 w-4 accent-emerald-300"
            />
            Play-in
          </label>
        )}
      </div>
    </div>
  )
}
