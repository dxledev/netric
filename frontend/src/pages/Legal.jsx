import { Link } from "react-router-dom"
import { openCookieSettings } from "../utils/cookieConsent"

const OPERATOR = "Dale Peligro"
const CONTACT_EMAIL = "dalepeligro@gmail.com"
const UPDATED = "October 26, 2026"

const navLink = "rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-100 transition-all duration-300 hover:bg-white/10"

function LegalShell({ title, children }) {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 pb-40 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex justify-between gap-3">
          <Link to="/" className={navLink}>← Return Home</Link>
        </div>

        <main className="animate-fade-up rounded-3xl border border-white/10 bg-slate-900 p-6 sm:p-8">
          <h1 className="font-display text-4xl font-extrabold text-white">{title}</h1>
          <p className="mt-2 text-sm text-slate-400">Last updated {UPDATED}</p>
          <div className="mt-8 space-y-8 text-slate-300 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:text-white [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-6">
            {children}
          </div>
          <nav aria-label="Legal pages" className="mt-10 flex flex-wrap gap-3 border-t border-white/10 pt-6">
            <Link to="/privacy" className={navLink}>Privacy Policy</Link>
            <Link to="/cookies" className={navLink}>Cookie Policy</Link>
            <button type="button" onClick={openCookieSettings} className={navLink}>Cookie settings</button>
          </nav>
        </main>
      </div>
    </div>
  )
}

export function Privacy() {
  return (
    <LegalShell title="Privacy Policy">
      <section>
        <h2>Who we are</h2>
        <p>Netric Sports is run by {OPERATOR}. Questions about this policy or your data: {CONTACT_EMAIL}.</p>
      </section>
      <section>
        <h2>What we collect</h2>
        <ul>
          <li>Account data: your email address and a hashed password. We record when you accepted this policy and which version.</li>
          <li>Profile data: a username and optional profile image you choose.</li>
          <li>Your activity: favorite players and teams, and the comments, replies and likes you post. Comments, replies, usernames and profile images are visible to other signed-in users.</li>
          <li>Notifications generated when other users reply to or like your comments.</li>
          <li>Usage data from Google Analytics, only if you accept analytics cookies.</li>
        </ul>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>To run your account, show your dashboard and comments, send in-app notifications, secure the service, and, with your consent, understand how the site is used. We do not sell your data.</p>
      </section>
      <section>
        <h2>Third parties</h2>
        <ul>
          <li>Google Analytics, which receives usage data only after you accept analytics cookies.</li>
          <li>Google Fonts, which serves the site's fonts. Your browser requests them from Google's servers, which receive your IP address.</li>
        </ul>
      </section>
      <section>
        <h2>Your choices and rights</h2>
        <p>You can change your username and profile image on your profile page and change your cookie choice at any time. To access, correct or delete your account and its data, email {CONTACT_EMAIL}. Depending on where you live, you may have further rights, including to complain to a data protection authority.</p>
      </section>
      <section>
        <h2>Retention and changes</h2>
        <p>We keep account data until you ask us to delete it. If we change this policy in a meaningful way we will update the date above.</p>
      </section>
    </LegalShell>
  )
}

export function Cookies() {
  return (
    <LegalShell title="Cookie Policy">
      <section>
        <h2>Essential storage</h2>
        <p>These are needed for the site to work and do not require consent. They are kept in your browser's local storage, not sent as cookies.</p>
        <ul>
          <li>A sign-in token that keeps you logged in.</li>
          <li>Cached player, team and dashboard data and your dashboard ordering, so pages load faster.</li>
          <li>Your cookie choice.</li>
        </ul>
      </section>
      <section>
        <h2>Analytics cookies (optional)</h2>
        <p>If you accept, Google Analytics sets cookies named <code>_ga</code> and <code>_ga_*</code> to count visits and see which pages are used. Nothing from Google Analytics loads until you accept. If you reject, or later withdraw consent, it does not load and its cookies are removed.</p>
      </section>
      <section>
        <h2>Your choice</h2>
        <button type="button" onClick={openCookieSettings} className={navLink}>
          Change cookie settings
        </button>
      </section>
    </LegalShell>
  )
}
