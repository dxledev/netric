import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { COOKIE_EVENTS, getCookieConsent, saveCookieConsent } from "../utils/cookieConsent"

export default function CookieBanner() {
  const [open, setOpen] = useState(() => getCookieConsent() === null)

  useEffect(() => {
    const show = () => setOpen(true)
    const hide = () => setOpen(false)
    window.addEventListener(COOKIE_EVENTS.open, show)
    window.addEventListener(COOKIE_EVENTS.change, hide)
    return () => {
      window.removeEventListener(COOKIE_EVENTS.open, show)
      window.removeEventListener(COOKIE_EVENTS.change, hide)
    }
  }, [])

  if (!open) return null

  const buttonClass = "rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition-all duration-300 hover:bg-white/10"

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      className="animate-fade-up fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-4xl rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl shadow-black/40 sm:bottom-4 sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-3xl text-sm text-slate-300">
          <h2 id="cookie-banner-title" className="font-display text-lg font-extrabold text-white">Cookies</h2>
          <p className="mt-1">
            Netric uses essential storage to keep you signed in. With your OK, we also use Google Analytics cookies to
            see how the site is used. Read the <Link to="/cookies" className="font-semibold text-orange-300 underline underline-offset-4">Cookie Policy</Link> and{" "}
            <Link to="/privacy" className="font-semibold text-orange-300 underline underline-offset-4">Privacy Policy</Link>.
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <button type="button" className={buttonClass} onClick={() => saveCookieConsent(false)}>Reject analytics</button>
          <button type="button" className={buttonClass} onClick={() => saveCookieConsent(true)}>Accept analytics</button>
        </div>
      </div>
    </div>
  )
}
