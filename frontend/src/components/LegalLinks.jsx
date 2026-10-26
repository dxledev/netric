import { Link } from "react-router-dom"
import { openCookieSettings } from "../utils/cookieConsent"

const linkClass = "text-sm text-slate-400 underline decoration-slate-400/40 underline-offset-4 hover:text-slate-200"

export default function LegalLinks({ className = "" }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap gap-x-6 gap-y-2 ${className}`}>
      <Link to="/privacy" className={linkClass}>Privacy Policy</Link>
      <Link to="/cookies" className={linkClass}>Cookie Policy</Link>
      <button type="button" onClick={openCookieSettings} className={linkClass}>Cookie settings</button>
    </nav>
  )
}
