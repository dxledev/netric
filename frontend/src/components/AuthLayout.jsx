// Shared shell for the logged-out pages (Login, Register).
// Netric = net + metric, so the page pairs a half-court shot chart (the net)
// with a box-score line (the metric). Everything is flat color, no gradients.

import Court from "./Court"
import LegalLinks from "./LegalLinks"

const MADE = [
  [250, 78, 0], [232, 96, 90], [276, 104, 180], [214, 138, 270], [290, 150, 360],
  [250, 168, 450], [196, 214, 540], [324, 204, 630], [60, 70, 720], [440, 66, 810],
  [250, 262, 900], [150, 250, 990],
]

const MISSED = [
  [134, 176, 140], [372, 188, 320], [420, 214, 500], [86, 238, 680], [312, 282, 860],
]

const SHOTS = [
  ...MADE.map(([x, y, delay]) => ({ x, y, made: true, delay: delay + 200 })),
  ...MISSED.map(([x, y, delay]) => ({ x, y, made: false, delay: delay + 200 })),
]

function Wordmark() {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden="true">
        <ellipse cx="20" cy="11" rx="12" ry="4" fill="none" stroke="var(--color-orange-400)" strokeWidth="3" />
        <path
          d="M9 13 L15 32 M16 14.5 L18 33 M24 14.5 L22 33 M31 13 L25 32"
          fill="none"
          stroke="var(--color-slate-300)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-display text-2xl font-extrabold tracking-tight text-white">
        netric<span className="text-orange-400"> sports</span>
      </span>
    </div>
  )
}

function ShotChart() {
  return (
    <figure className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900">
      <figcaption className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3 text-sm text-slate-300">
        <span>Sample shot chart</span>
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-400" /> Made
          </span>
          <span className="flex items-center gap-1.5 text-red-300">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="text-slate-300">Missed</span>
          </span>
        </span>
      </figcaption>

      <Court shots={SHOTS} label="Half-court diagram with sample made and missed shots">
        <path
          className="shot-arc"
          pathLength="1"
          d="M92 296 Q150 20 240 46"
          fill="none"
          stroke="var(--color-orange-400)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <circle cx="92" cy="296" r="11" fill="var(--color-orange-400)" />
      </Court>

      <div className="grid grid-cols-4 border-t border-white/10 text-center tabular-nums">
        {[
          ["PTS", "28"],
          ["REB", "7"],
          ["AST", "9"],
          ["TS%", "62.4"],
        ].map(([label, value]) => (
          <div key={label} className="border-r border-white/10 px-2 py-3 last:border-r-0">
            <div className="font-display text-2xl font-extrabold text-white">{value}</div>
            <div className="text-xs text-slate-400">{label}</div>
          </div>
        ))}
      </div>
      <p className="border-t border-white/10 px-5 py-2.5 text-xs text-slate-400">
        Illustrative box score line. Your dashboard shows real NBA numbers.
      </p>
    </figure>
  )
}

export default function AuthLayout({ title, lede, features, children }) {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-8 lg:py-12">
      <div className="mx-auto grid max-w-6xl gap-x-14 gap-y-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <header className="animate-fade-up lg:col-start-1 lg:row-start-1">
          <Wordmark />
          <h1 className="mt-8 max-w-xl text-4xl font-extrabold leading-[1.05] text-white sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-300 sm:text-lg">{lede}</p>
        </header>

        <main className="animate-fade-up rounded-3xl border border-white/10 bg-slate-900 p-6 [animation-delay:120ms] sm:p-8 lg:sticky lg:top-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-2">
          {children}
        </main>

        <section className="space-y-6 lg:col-start-1 lg:row-start-2">
          <ShotChart />
          <ul className="space-y-3">
            {features.map(([accent, heading, body]) => (
              <li key={heading} className="flex gap-4">
                <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${accent}`} aria-hidden="true" />
                <p className="text-slate-300">
                  <span className="font-semibold text-white">{heading}.</span> {body}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <LegalLinks className="pb-28 lg:col-span-2 lg:pb-0" />
      </div>
    </div>
  )
}
