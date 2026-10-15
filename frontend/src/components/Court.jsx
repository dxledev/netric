// Half-court diagram shared by the login page and the game summary.
// `shots` is a list of { x, y, made, delay } in court units (50ft x 47ft, 10 units per ft,
// baseline at y=0, hoop at 250,52.5). `children` render above the dots.

export default function Court({ shots = [], dotRadius = 9, label, children }) {
  const cross = dotRadius * 0.78

  return (
    <svg viewBox="-10 -10 520 330" className="block w-full" role="img" aria-label={label}>
      <g fill="none" stroke="var(--color-slate-600)" strokeWidth="3" strokeLinecap="round">
        <rect x="0" y="0" width="500" height="310" rx="2" />
        <rect x="170" y="0" width="160" height="190" />
        <path d="M190 190 A60 60 0 0 1 310 190" />
        <path d="M190 190 A60 60 0 0 0 310 190" strokeDasharray="7 9" />
        <path d="M210 52.5 A40 40 0 0 0 290 52.5" />
        <path d="M30 0 V142 A237.5 237.5 0 0 0 470 142 V0" />
        <path d="M220 40 H280" strokeWidth="5" stroke="var(--color-slate-400)" />
      </g>
      <circle cx="250" cy="52.5" r="9" fill="none" stroke="var(--color-orange-400)" strokeWidth="4" />

      {shots.map(({ x, y, made, delay }) =>
        made ? (
          <circle
            key={`m${x}-${y}`}
            className="shot"
            style={{ animationDelay: `${delay}ms` }}
            cx={x}
            cy={y}
            r={dotRadius}
            fill="var(--color-blue-400)"
            fillOpacity="0.9"
          />
        ) : (
          <path
            key={`x${x}-${y}`}
            className="shot"
            style={{ animationDelay: `${delay}ms` }}
            d={`M${x - cross} ${y - cross} L${x + cross} ${y + cross} M${x + cross} ${y - cross} L${x - cross} ${y + cross}`}
            stroke="var(--color-red-400)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        ),
      )}

      {children}
    </svg>
  )
}
